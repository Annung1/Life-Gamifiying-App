// Make functions available globally for HTML onclick handlers
window.toggleTaskComplete = toggleTaskComplete;
window.deleteTask = deleteTask;
window.deleteInfo = deleteInfo;
window.toggleTaskDetails = toggleTaskDetails;
window.syncWithCalendar = syncWithCalendar;
window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;

// Google API Configuration
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';
const CALENDAR_DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES =
  'openid email profile ' +
  'https://www.googleapis.com/auth/spreadsheets ' +
  'https://www.googleapis.com/auth/calendar';

// Your Google Cloud Project credentials
const CLIENT_ID = "774756685824-gumlet0m3gqtk7fb9b181a7cpe6ioh6t.apps.googleusercontent.com";
const API_KEY = "AIzaSyCVaEWYpxyx1vFTUzrPTXCKlLWlMdr1F18";

// App State
let tokenClient;
let gapiInited = false;
let gisInited = false;
let currentUser = null;
let spreadsheetId = null;
let appData = {
  tasks: [],
  userStats: {
    currentPoints: 0,
    currentStreak: 0,
    level: 1,
    completedTasks: 0,
    lastActivityDate: null
  },
  importantInfo: [],
  achievements: [
    {id: 1, name: "First Steps", description: "Complete your first task", earned: false},
    {id: 2, name: "Consistency", description: "Maintain a 7-day streak", earned: false},
    {id: 3, name: "High Achiever", description: "Earn 1000 points", earned: false},
    {id: 4, name: "Task Master", description: "Complete 50 tasks", earned: false}
  ]
};

// ===== AUTHENTICATION =====
function gapiLoaded() {
  gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
  await gapi.client.init({
    apiKey: API_KEY,
    discoveryDocs: [DISCOVERY_DOC, CALENDAR_DISCOVERY_DOC],
  });
  gapiInited = true;
  maybeEnableButtons();
}

function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: '',
  });
  gisInited = true;
  maybeEnableButtons();
}

function maybeEnableButtons() {
  if (gapiInited && gisInited) {
    document.getElementById('signInBtn').style.display = 'block';
    setupEventListeners();
    // Check for saved authentication
    checkSavedAuth();
  }
}

// Check for saved auth on page load
async function checkSavedAuth() {
  const savedToken = localStorage.getItem('lifequest_auth_token');
  const savedUser = localStorage.getItem('lifequest_user_data');
  
  if (savedToken && savedUser) {
    try {
      // Set the saved token
      gapi.client.setToken(JSON.parse(savedToken));
      currentUser = JSON.parse(savedUser);
      
      // Verify token is still valid
      const response = await gapi.client.request({
        'path': 'https://www.googleapis.com/oauth2/v2/userinfo',
      });
      
      if (response.result) {
        // Token is valid, auto-sign in
        await continueSignIn();
        showNotification('✅ Automatically signed in!');
      }
    } catch (error) {
      // Token expired, clear saved data
      localStorage.removeItem('lifequest_auth_token');
      localStorage.removeItem('lifequest_user_data');
      console.log('Saved token expired');
    }
  }
}

function handleAuthClick() {
  tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) {
      throw (resp);
    }
    await handleSignIn();
  };

  if (gapi.client.getToken() === null) {
    tokenClient.requestAccessToken({prompt: 'consent'});
  } else {
    tokenClient.requestAccessToken({prompt: ''});
  }
}

async function handleSignIn() {
  try {
    // Get user info
    const response = await gapi.client.request({
      'path': 'https://www.googleapis.com/oauth2/v2/userinfo',
    });

    currentUser = response.result;
    
    // Save auth data for "remember me"
    const token = gapi.client.getToken();
    localStorage.setItem('lifequest_auth_token', JSON.stringify(token));
    localStorage.setItem('lifequest_user_data', JSON.stringify(currentUser));

    await continueSignIn();
    showNotification('✅ Successfully signed in and synced with Google Sheets!');

  } catch (error) {
    console.error('Sign in error:', error);
    showNotification('❌ Failed to sign in. Please try again.');
  }
}

async function continueSignIn() {
  // Update UI
  document.getElementById('authSection').style.display = 'none';
  document.getElementById('appSection').style.display = 'block';
  document.getElementById('userName').textContent = currentUser.name;
  document.getElementById('userPhoto').src = currentUser.picture;

  // Initialize or retrieve spreadsheet
  await initializeSpreadsheet();
  await loadAllData();
}

function handleSignOut() {
  const token = gapi.client.getToken();
  if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken('');
  }

  // Clear saved auth data but KEEP spreadsheet ID
  localStorage.removeItem('lifequest_auth_token');
  localStorage.removeItem('lifequest_user_data');

  document.getElementById('authSection').style.display = 'block';
  document.getElementById('appSection').style.display = 'none';
  currentUser = null;
  // Don't clear spreadsheetId - it will be found on next login
}

// ===== SPREADSHEET MANAGEMENT =====
async function initializeSpreadsheet() {
  try {
    // FIX: Check if user already has a saved spreadsheet ID
    const savedSpreadsheetId = localStorage.getItem(`lifequest_spreadsheet_${currentUser.id}`);
    
    if (savedSpreadsheetId) {
      // Try to access the existing spreadsheet
      try {
        const testResponse = await gapi.client.sheets.spreadsheets.get({
          spreadsheetId: savedSpreadsheetId
        });
        
        if (testResponse.result) {
          // Spreadsheet exists and is accessible
          spreadsheetId = savedSpreadsheetId;
          console.log('✅ Using existing spreadsheet:', spreadsheetId);
          return;
        }
      } catch (error) {
        console.log('Saved spreadsheet not accessible, creating new one');
        localStorage.removeItem(`lifequest_spreadsheet_${currentUser.id}`);
      }
    }

    // Only create new spreadsheet if none exists or previous one is gone
    console.log('Creating new spreadsheet...');
    const response = await gapi.client.sheets.spreadsheets.create({
      resource: {
        properties: {
          title: `Life Quest - ${currentUser.name}`
        },
        sheets: [
          {properties: {title: 'Tasks', gridProperties: {frozenRowCount: 1}}},
          {properties: {title: 'User_Stats', gridProperties: {frozenRowCount: 1}}},
          {properties: {title: 'Important_Info', gridProperties: {frozenRowCount: 1}}},
          {properties: {title: 'Achievements', gridProperties: {frozenRowCount: 1}}}
        ]
      }
    });

    spreadsheetId = response.result.spreadsheetId;

    // Initialize headers and default data for new spreadsheet
    await setupSpreadsheetHeaders();
    await initializeUserStats();

    // Save spreadsheet ID to localStorage
    localStorage.setItem(`lifequest_spreadsheet_${currentUser.id}`, spreadsheetId);
    console.log('✅ Created new spreadsheet:', spreadsheetId);

  } catch (error) {
    console.error('Error with spreadsheet:', error);
    showNotification('❌ Failed to access/create Google Sheet. Please try again.');
  }
}

async function setupSpreadsheetHeaders() {
  const requests = [
    {
      range: 'Tasks!A1:L1',
      values: [['ID', 'Title', 'Description', 'Priority', 'Due Date', 'Category', 'Is Recurring', 'Recurring Type', 'Is Completed', 'Created Date', 'Subtasks', 'Calendar Event ID']]
    },
    {
      range: 'User_Stats!A1:B1',
      values: [['Stat Name', 'Value']]
    },
    {
      range: 'Important_Info!A1:E1',
      values: [['ID', 'Title', 'Content', 'Category', 'Created Date']]
    },
    {
      range: 'Achievements!A1:E1',
      values: [['Achievement ID', 'Name', 'Description', 'Is Earned', 'Date Earned']]
    }
  ];

  for (const request of requests) {
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: request.range,
      valueInputOption: 'USER_ENTERED',
      resource: {values: request.values}
    });
  }
}

async function initializeUserStats() {
  const statsData = [
    ['Current Points', 0],
    ['Current Streak', 0], 
    ['Level', 1],
    ['Completed Tasks', 0],
    ['Last Activity Date', new Date().toISOString()]
  ];

  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: 'User_Stats!A2:B6',
    valueInputOption: 'USER_ENTERED',
    resource: {values: statsData}
  });
}

// ===== DATA LOADING =====
async function loadAllData() {
  try {
    updateSyncStatus('🔄 Loading data...');

    await Promise.all([
      loadTasks(),
      loadUserStats(),
      loadImportantInfo()
    ]);

    renderTasks();
    renderImportantInfo();
    updateStats();

    updateSyncStatus('✅ Synced');

  } catch (error) {
    console.error('Error loading data:', error);
    updateSyncStatus('❌ Sync failed');
    loadFromLocalStorage(); // Fallback to local storage
  }
}

async function loadTasks() {
  const response = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Tasks!A2:L1000',
  });

  const rows = response.result.values || [];
  appData.tasks = rows.map(row => ({
    id: row[0],
    title: row[1],
    description: row[2],
    priority: row[3],
    dueDate: row[4],
    category: row[5],
    isRecurring: row[6] === 'TRUE',
    recurringType: row[7],
    isCompleted: row[8] === 'TRUE',
    createdDate: row[9],
    subtasks: row[10] ? JSON.parse(row[10]) : [],
    calendarEventId: row[11]
  }));
}

async function loadUserStats() {
  const response = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'User_Stats!A2:B6',
  });

  const rows = response.result.values || [];
  const stats = {};
  rows.forEach(row => {
    stats[row[0]] = row[1];
  });

  appData.userStats = {
    currentPoints: parseInt(stats['Current Points']) || 0,
    currentStreak: parseInt(stats['Current Streak']) || 0,
    level: parseInt(stats['Level']) || 1,
    completedTasks: parseInt(stats['Completed Tasks']) || 0,
    lastActivityDate: stats['Last Activity Date']
  };
}

async function loadImportantInfo() {
  const response = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Important_Info!A2:E1000',
  });

  const rows = response.result.values || [];
  appData.importantInfo = rows.map(row => ({
    id: row[0],
    title: row[1],
    content: row[2],
    category: row[3],
    createdDate: row[4]
  }));
}

// ===== DATA SAVING =====
async function saveTask(task) {
  try {
    const taskRow = [
      task.id,
      task.title,
      task.description,
      task.priority,
      task.dueDate,
      task.category,
      task.isRecurring.toString(),
      task.recurringType || '',
      task.isCompleted.toString(),
      task.createdDate,
      JSON.stringify(task.subtasks || []),
      task.calendarEventId || ''
    ];

    // Find next empty row
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'Tasks!A:A',
    });

    const nextRow = (response.result.values?.length || 1) + 1;

    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: `Tasks!A${nextRow}:L${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: {values: [taskRow]}
    });

    saveToLocalStorage();

  } catch (error) {
    console.error('Error saving task:', error);
    throw error;
  }
}

async function updateTask(task) {
  try {
    // Find the row index for this task
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'Tasks!A:A',
    });

    const rows = response.result.values || [];
    const rowIndex = rows.findIndex((row, index) => index > 0 && row[0] === task.id);

    if (rowIndex !== -1) {
      const actualRow = rowIndex + 1;

      const taskRow = [
        task.id,
        task.title,
        task.description,
        task.priority,
        task.dueDate,
        task.category,
        task.isRecurring.toString(),
        task.recurringType || '',
        task.isCompleted.toString(),
        task.createdDate,
        JSON.stringify(task.subtasks || []),
        task.calendarEventId || ''
      ];

      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: `Tasks!A${actualRow}:L${actualRow}`,
        valueInputOption: 'USER_ENTERED',
        resource: {values: [taskRow]}
      });
    }

    saveToLocalStorage();

  } catch (error) {
    console.error('Error updating task:', error);
    throw error;
  }
}

async function deleteTaskFromSheet(taskId) {
  try {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'Tasks!A:A',
    });

    const rows = response.result.values || [];
    const rowIndex = rows.findIndex((row, index) => index > 0 && row[0] === taskId);

    if (rowIndex !== -1) {
      const actualRow = rowIndex + 1;

      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: 0,
                dimension: 'ROWS',
                startIndex: actualRow - 1,
                endIndex: actualRow
              }
            }
          }]
        }
      });
    }

    saveToLocalStorage();

  } catch (error) {
    console.error('Error deleting task:', error);
    throw error;
  }
}

async function saveUserStats() {
  try {
    const statsData = [
      ['Current Points', appData.userStats.currentPoints],
      ['Current Streak', appData.userStats.currentStreak], 
      ['Level', appData.userStats.level],
      ['Completed Tasks', appData.userStats.completedTasks],
      ['Last Activity Date', new Date().toISOString()]
    ];

    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: 'User_Stats!A2:B6',
      valueInputOption: 'USER_ENTERED',
      resource: {values: statsData}
    });

    saveToLocalStorage();

  } catch (error) {
    console.error('Error saving user stats:', error);
  }
}

async function saveInfo(info) {
  try {
    const infoRow = [
      info.id,
      info.title,
      info.content,
      info.category,
      info.createdDate
    ];

    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'Important_Info!A:A',
    });

    const nextRow = (response.result.values?.length || 1) + 1;

    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: `Important_Info!A${nextRow}:E${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: {values: [infoRow]}
    });

    saveToLocalStorage();

  } catch (error) {
    console.error('Error saving info:', error);
    throw error;
  }
}

// Local Storage Backup
function saveToLocalStorage() {
  if (currentUser) {
    const data = {
      tasks: appData.tasks,
      userStats: appData.userStats,
      importantInfo: appData.importantInfo,
      spreadsheetId: spreadsheetId
    };
    localStorage.setItem(`lifequest_data_${currentUser.id}`, JSON.stringify(data));
  }
}

function loadFromLocalStorage() {
  if (currentUser) {
    const savedData = localStorage.getItem(`lifequest_data_${currentUser.id}`);
    if (savedData) {
      const data = JSON.parse(savedData);
      appData.tasks = data.tasks || [];
      appData.userStats = data.userStats || appData.userStats;
      appData.importantInfo = data.importantInfo || [];
      if (data.spreadsheetId) {
        spreadsheetId = data.spreadsheetId;
      }

      renderTasks();
      renderImportantInfo();
      updateStats();

      showNotification('📱 Loaded from offline storage');
    }
  }
}

// ===== GOOGLE CALENDAR INTEGRATION =====
async function addTaskToCalendar(task) {
  try {
    const event = {
      summary: task.title,
      description: task.description,
      start: {
        dateTime: new Date(task.dueDate).toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: new Date(new Date(task.dueDate).getTime() + 60*60*1000).toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      reminders: {
        useDefault: false,
        overrides: [
          {method: 'popup', minutes: 60},
          {method: 'popup', minutes: 10},
        ],
      },
    };

    if (task.isRecurring) {
      const recurRules = {
        daily: 'RRULE:FREQ=DAILY',
        weekly: 'RRULE:FREQ=WEEKLY',
        monthly: 'RRULE:FREQ=MONTHLY',
        yearly: 'RRULE:FREQ=YEARLY'
      };
      event.recurrence = [recurRules[task.recurringType]];
    }

    const response = await gapi.client.calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });

    return response.result.id;

  } catch (error) {
    console.error('Error adding to calendar:', error);
    return null;
  }
}

// ===== UI FUNCTIONS =====
function setupEventListeners() {
  // Authentication
  document.getElementById('signInBtn').addEventListener('click', handleAuthClick);
  document.getElementById('signOutBtn').addEventListener('click', handleSignOut);

  // Tab navigation
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      switchTab(this.dataset.tab);
    });
  });

  // Modals
  document.getElementById('addTaskBtn').addEventListener('click', showAddTaskModal);
  document.getElementById('addInfoBtn').addEventListener('click', showAddInfoModal);

  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', function() {
      this.closest('.modal').style.display = 'none';
    });
  });

  // Forms
  document.getElementById('taskForm').addEventListener('submit', handleTaskSubmission);
  document.getElementById('infoForm').addEventListener('submit', handleInfoSubmission);

  // Recurring task checkbox
  document.getElementById('taskRecurring').addEventListener('change', function() {
    document.getElementById('recurringType').disabled = !this.checked;
  });

  // Calendar sync
  document.getElementById('syncCalendarBtn').addEventListener('click', syncWithCalendar);
}

function switchTab(tabName) {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`${tabName}Tab`).classList.add('active');
}

function updateSyncStatus(status) {
  document.getElementById('syncStatus').textContent = status;
}

function updateStats() {
  document.getElementById('points').textContent = appData.userStats.currentPoints;
  document.getElementById('streak').textContent = appData.userStats.currentStreak;
  document.getElementById('level').textContent = `Level ${appData.userStats.level}`;
  updateDailyProgress();
}

function updateDailyProgress() {
  const todayTasks = appData.tasks.filter(task => task.category === 'Today');
  const completedTodayTasks = todayTasks.filter(task => task.isCompleted);
  const progress = todayTasks.length > 0 ? (completedTodayTasks.length / todayTasks.length) * 100 : 0;

  document.getElementById('dailyProgress').style.width = progress + '%';
}

function renderTasks() {
  const categories = ['Today', 'In 3 Days', 'This Week', 'This Month', 'Long-term Plan'];
  const tasksContainer = document.getElementById('tasksList');

  if (appData.tasks.length === 0) {
    tasksContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <h3>No tasks yet</h3>
        <p>Start by adding your first task and it will sync to Google Sheets automatically!</p>
      </div>
    `;
    return;
  }

  tasksContainer.innerHTML = '';

  categories.forEach(category => {
    const categoryTasks = appData.tasks
      .filter(task => task.category === category)
      .sort((a, b) => {
        const priorityOrder = { 'High': 3, 'Medium': 2, 'Low': 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });

    if (categoryTasks.length > 0) {
      const categorySection = document.createElement('div');
      categorySection.className = 'task-category';
      categorySection.innerHTML = `
        <div class="category-header">
          <h3>${category}</h3>
          <span class="task-count">${categoryTasks.length}</span>
        </div>
        <div class="task-list">
          ${categoryTasks.map(task => createTaskHTML(task)).join('')}
        </div>
      `;
      tasksContainer.appendChild(categorySection);
    }
  });
}

function createTaskHTML(task) {
  const priorityClass = task.priority.toLowerCase();
  const recurringIcon = task.isRecurring ? '<span class="recurring-icon">🔄</span>' : '';
  const calendarIcon = task.calendarEventId ? '<span class="calendar-icon">📅</span>' : '';

  return `
    <div class="task-item ${task.isCompleted ? 'completed' : ''}" data-task-id="${task.id}">
      <div class="task-header" onclick="toggleTaskDetails('${task.id}')">
        <div class="task-left">
          <button class="task-checkbox ${task.isCompleted ? 'checked' : ''}" 
                  onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')" 
                  aria-label="Mark task complete">
            ${task.isCompleted ? '✓' : ''}
          </button>
          <div class="task-content">
            <div class="task-title">${task.title}</div>
            <div class="task-meta">
              <span class="priority-badge ${priorityClass}">${task.priority}</span>
              ${recurringIcon}
              ${calendarIcon}
              <span class="due-date">${formatDueDate(task.dueDate)}</span>
            </div>
          </div>
        </div>
        <div class="task-actions">
          <button class="delete-btn" onclick="event.stopPropagation(); deleteTask('${task.id}')" 
                  title="Delete task">🗑️</button>
          <button class="expand-btn">▼</button>
        </div>
      </div>
      <div class="task-details" id="details-${task.id}">
        <div class="task-description">${task.description || 'No description'}</div>
      </div>
    </div>
  `;
}

function renderImportantInfo() {
  const infoContainer = document.getElementById('importantInfoList');

  if (appData.importantInfo.length === 0) {
    infoContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💡</div>
        <h3>No important information yet</h3>
        <p>Add important notes that will be saved to Google Sheets for easy access!</p>
      </div>
    `;
    return;
  }

  infoContainer.innerHTML = appData.importantInfo.map(info => `
    <div class="info-item">
      <div class="info-header">
        <h4>${info.title}</h4>
        <div class="info-actions">
          <button class="delete-btn" onclick="deleteInfo('${info.id}')" title="Delete information">🗑️</button>
        </div>
      </div>
      <div class="info-content">${info.content.replace(/\n/g, '<br>')}</div>
      ${info.category ? `<div class="info-category">${info.category}</div>` : ''}
    </div>
  `).join('');
}

// ===== EVENT HANDLERS =====
function showAddTaskModal() {
  document.getElementById('taskModal').style.display = 'block';
  document.getElementById('taskForm').reset();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  document.getElementById('taskDueDate').value = tomorrow.toISOString().slice(0, 16);
}

function showAddInfoModal() {
  document.getElementById('infoModal').style.display = 'block';
  document.getElementById('infoForm').reset();
}

async function handleTaskSubmission(e) {
  e.preventDefault();

  try {
    const formData = new FormData(e.target);
    const task = {
      id: Date.now().toString(),
      title: formData.get('title'),
      description: formData.get('description'),
      priority: formData.get('priority'),
      dueDate: formData.get('dueDate'),
      category: categorizeByDate(formData.get('dueDate')),
      isRecurring: formData.get('isRecurring') === 'on',
      recurringType: formData.get('recurringType') || null,
      subtasks: [],
      isCompleted: false,
      createdDate: new Date().toISOString(),
      calendarEventId: null
    };

    if (formData.get('addToCalendar') === 'on') {
      task.calendarEventId = await addTaskToCalendar(task);
    }

    appData.tasks.push(task);
    await saveTask(task);
    renderTasks();
    updateStats();

    document.getElementById('taskModal').style.display = 'none';
    showNotification('✅ Task added and synced to Google Sheets!');

  } catch (error) {
    console.error('Error saving task:', error);
    showNotification('❌ Failed to save task. Please try again.');
  }
}

async function handleInfoSubmission(e) {
  e.preventDefault();

  try {
    const formData = new FormData(e.target);
    const info = {
      id: Date.now().toString(),
      title: formData.get('title'),
      content: formData.get('content'),
      category: formData.get('category') || '',
      createdDate: new Date().toISOString()
    };

    appData.importantInfo.push(info);
    await saveInfo(info);
    renderImportantInfo();

    document.getElementById('infoModal').style.display = 'none';
    showNotification('✅ Information added and synced!');

  } catch (error) {
    console.error('Error saving info:', error);
    showNotification('❌ Failed to save information. Please try again.');
  }
}

async function toggleTaskComplete(taskId) {
  const task = appData.tasks.find(t => t.id === taskId);
  if (task) {
    task.isCompleted = !task.isCompleted;

    if (task.isCompleted) {
      let points = { 'High': 15, 'Medium': 10, 'Low': 5 }[task.priority];
      appData.userStats.currentPoints += points;
      appData.userStats.completedTasks += 1;
      appData.userStats.level = Math.floor(appData.userStats.currentPoints / 100) + 1;

      await saveUserStats();
      showNotification(`🎉 +${points} points! Task completed!`);
    }

    await updateTask(task);
    renderTasks();
    updateStats();
  }
}

async function deleteTask(taskId) {
  if (confirm('Are you sure you want to delete this task?')) {
    try {
      appData.tasks = appData.tasks.filter(task => task.id !== taskId);
      await deleteTaskFromSheet(taskId);
      renderTasks();
      updateStats();
      showNotification('🗑️ Task deleted and synced!');
    } catch (error) {
      console.error('Error deleting task:', error);
      showNotification('❌ Failed to delete task.');
    }
  }
}

async function deleteInfo(infoId) {
  if (confirm('Are you sure you want to delete this information?')) {
    try {
      appData.importantInfo = appData.importantInfo.filter(info => info.id !== infoId);
      await deleteInfoFromSheet(infoId);
      renderImportantInfo();
      showNotification('🗑️ Information deleted and synced!');
    } catch (error) {
      console.error('Error deleting info:', error);
      showNotification('❌ Failed to delete information.');
    }
  }
}

async function deleteInfoFromSheet(infoId) {
  try {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'Important_Info!A:A',
    });

    const rows = response.result.values || [];
    const rowIndex = rows.findIndex((row, index) => index > 0 && row[0] === infoId);

    if (rowIndex !== -1) {
      const actualRow = rowIndex + 1;

      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: 2,
                dimension: 'ROWS',
                startIndex: actualRow - 1,
                endIndex: actualRow
              }
            }
          }]
        }
      });
    }

    saveToLocalStorage();

  } catch (error) {
    console.error('Error deleting info:', error);
    throw error;
  }
}

function toggleTaskDetails(taskId) {
  const details = document.getElementById(`details-${taskId}`);
  const expandBtn = document.querySelector(`[data-task-id="${taskId}"] .expand-btn`);

  if (details.style.display === 'block') {
    details.style.display = 'none';
    expandBtn.textContent = '▼';
  } else {
    details.style.display = 'block';
    expandBtn.textContent = '▲';
  }
}

function categorizeByDate(dueDateString) {
  const dueDate = new Date(dueDateString);
  const today = new Date();
  const diffTime = dueDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Today';
  if (diffDays <= 3) return 'In 3 Days';
  if (diffDays <= 7) return 'This Week';
  if (diffDays <= 30) return 'This Month';
  return 'Long-term Plan';
}

function formatDueDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

async function syncWithCalendar() {
  try {
    updateSyncStatus('🔄 Syncing with calendar...');

    let syncedCount = 0;
    for (const task of appData.tasks) {
      if (!task.calendarEventId && !task.isCompleted) {
        const eventId = await addTaskToCalendar(task);
        if (eventId) {
          task.calendarEventId = eventId;
          await updateTask(task);
          syncedCount++;
        }
      }
    }

    renderTasks();
    updateSyncStatus('✅ Synced');
    showNotification(`📅 ${syncedCount} tasks synced to Google Calendar!`);

  } catch (error) {
    console.error('Calendar sync error:', error);
    updateSyncStatus('❌ Sync failed');
    showNotification('❌ Failed to sync with calendar.');
  }
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.getElementById('notifications').appendChild(notification);

  setTimeout(() => {
    notification.classList.add('show');
  }, 100);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 4000);
}

// Initialize app when page loads
document.addEventListener('DOMContentLoaded', function() {
  if (typeof gapi !== 'undefined') {
    gapiLoaded();
  }
  if (typeof google !== 'undefined') {
    gisLoaded();
  }
});

