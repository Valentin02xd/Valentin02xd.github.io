
// Configuración de horarios
const TIME_SLOTS = [
    '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
    '16:00', '17:00', '18:00', '19:00'
];

// Storage para los turnos
let appointments = JSON.parse(localStorage.getItem('appointments')) || [];
let currentUser = null;
let dailyStats = JSON.parse(localStorage.getItem('dailyStats')) || {};
let realTimeUsers = JSON.parse(localStorage.getItem('realTimeUsers')) || [];

// Inicializar la aplicación
document.addEventListener('DOMContentLoaded', function() {
    checkAuthenticationStatus();
    initializeAuthSystem();
    initializeRealTimeSync();
    initializeDateInput();
    initializeGridDate();
    loadTimeSlots();
    displayAppointments();
    displayTimeSlotsGrid();
    setupEventListeners();
});

function initializeDateInput() {
    const dateInput = document.getElementById('appointmentDate');
    const today = new Date();
    const maxDate = new Date('2100-12-31'); // Permitir reservas hasta el año 2100
    
    dateInput.min = today.toISOString().split('T')[0];
    dateInput.max = maxDate.toISOString().split('T')[0];
    dateInput.value = today.toISOString().split('T')[0];
    
    dateInput.addEventListener('change', loadTimeSlots);
}

function initializeGridDate() {
    const gridDateInput = document.getElementById('gridDate');
    const today = new Date();
    const maxDate = new Date('2100-12-31'); // Permitir visualizar hasta el año 2100
    
    gridDateInput.min = today.toISOString().split('T')[0];
    gridDateInput.max = maxDate.toISOString().split('T')[0];
    gridDateInput.value = today.toISOString().split('T')[0];
    
    gridDateInput.addEventListener('change', displayTimeSlotsGrid);
}

function loadTimeSlots() {
    const dateInput = document.getElementById('appointmentDate');
    const timeSelect = document.getElementById('timeSlot');
    const selectedDate = dateInput.value;
    
    if (!selectedDate) return;
    
    // Recargar datos más recientes
    appointments = JSON.parse(localStorage.getItem('appointments')) || [];
    
    // Limpiar opciones existentes
    timeSelect.innerHTML = '<option value="">Selecciona un horario</option>';
    
    // Obtener turnos ocupados para la fecha seleccionada
    const occupiedSlots = appointments
        .filter(apt => apt.date === selectedDate)
        .map(apt => ({ time: apt.time, name: apt.name }));
    
    // Agregar opciones de horario
    TIME_SLOTS.forEach(time => {
        const option = document.createElement('option');
        option.value = time;
        
        const occupiedSlot = occupiedSlots.find(slot => slot.time === time);
        
        if (occupiedSlot) {
            option.textContent = `${time} - Ocupado por ${occupiedSlot.name}`;
            option.disabled = true;
            option.classList.add('time-slot-occupied');
            option.title = `Este horario ya fue reservado por ${occupiedSlot.name}`;
        } else {
            option.textContent = `${time} - Disponible`;
            option.classList.add('time-slot-available');
            option.title = 'Horario disponible para reservar';
        }
        
        timeSelect.appendChild(option);
    });
    
    // Mostrar resumen de disponibilidad
    const availableCount = TIME_SLOTS.length - occupiedSlots.length;
    const summaryText = `${availableCount} de ${TIME_SLOTS.length} horarios disponibles`;
    
    const summaryOption = document.createElement('option');
    summaryOption.disabled = true;
    summaryOption.textContent = `─── ${summaryText} ───`;
    summaryOption.style.fontStyle = 'italic';
    summaryOption.style.textAlign = 'center';
    timeSelect.insertBefore(summaryOption, timeSelect.children[1]);
}

function setupEventListeners() {
    const form = document.getElementById('appointmentForm');
    const modal = document.getElementById('confirmationModal');
    const closeBtn = document.querySelector('.close');
    
    form.addEventListener('submit', handleFormSubmit);
    closeBtn.addEventListener('click', closeModal);
    
    // Cerrar modal al hacer clic fuera de él
    window.addEventListener('click', function(event) {
        if (event.target === modal) {
            closeModal();
        }
    });
}

function handleFormSubmit(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const appointmentData = {
        id: Date.now(),
        name: formData.get('userName').trim(),
        date: formData.get('appointmentDate'),
        time: formData.get('timeSlot'),
        createdAt: new Date().toISOString(),
        userId: currentUser.id,
        userEmail: currentUser.email
    };
    
    // Recargar datos más recientes antes de validar
    appointments = JSON.parse(localStorage.getItem('appointments')) || [];
    
    // Validar que no haya conflictos (verificación doble)
    const conflict = appointments.find(apt => 
        apt.date === appointmentData.date && apt.time === appointmentData.time
    );
    
    if (conflict) {
        showRealTimeNotification(
            `❌ El horario ${appointmentData.time} ya fue reservado por ${conflict.name}`, 
            'error'
        );
        loadTimeSlots(); // Actualizar slots disponibles
        return;
    }
    
    // Guardar el turno
    appointments.push(appointmentData);
    localStorage.setItem('appointments', JSON.stringify(appointments));
    
    // Actualizar hash para sincronización
    const appointmentsString = JSON.stringify(appointments);
    const newHash = btoa(appointmentsString).slice(0, 10);
    localStorage.setItem('lastAppointmentsHash', newHash);
    localStorage.setItem('lastSyncTimestamp', Date.now().toString());
    
    // Registrar estadística del día y actualizar inmediatamente
    updateDailyStats(appointmentData.date);
    
    // Mostrar confirmación con estadísticas actualizadas
    showConfirmationWithStats(appointmentData);
    
    // Notificar a otros usuarios
    broadcastAppointmentCreated(appointmentData);
    
    // Limpiar formulario y recargar datos
    event.target.reset();
    document.getElementById('appointmentDate').value = new Date().toISOString().split('T')[0];
    loadTimeSlots();
    displayAppointments();
    displayTimeSlotsGrid();
}

function broadcastAppointmentCreated(appointment) {
    // Crear evento para notificar nueva reserva
    const event = new CustomEvent('appointmentCreated', {
        detail: {
            name: appointment.name,
            date: appointment.date,
            time: appointment.time,
            timestamp: appointment.createdAt
        }
    });
    
    window.dispatchEvent(event);
    
    // Notificación para el usuario actual
    setTimeout(() => {
        showRealTimeNotification(
            `✅ Tu turno para las ${appointment.time} ha sido confirmado`, 
            'success'
        );
    }, 500);
}

function showConfirmation(appointment) {
    const modal = document.getElementById('confirmationModal');
    const detailsDiv = document.getElementById('confirmationDetails');
    
    const formattedDate = new Date(appointment.date + 'T00:00:00').toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    detailsDiv.innerHTML = `
        <p><strong>Nombre:</strong> ${appointment.name}</p>
        <p><strong>Fecha:</strong> ${formattedDate}</p>
        <p><strong>Horario:</strong> ${appointment.time}</p>
        <p><strong>Número de turno:</strong> #${appointment.id}</p>
    `;
    
    modal.style.display = 'block';
}

function showConfirmationWithStats(appointment) {
    const modal = document.getElementById('confirmationModal');
    const detailsDiv = document.getElementById('confirmationDetails');
    
    const formattedDate = new Date(appointment.date + 'T00:00:00').toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    // Obtener estadísticas del día
    const turnosHoy = dailyStats[appointment.date] || 0;
    const totalTurnos = Object.values(dailyStats).reduce((sum, count) => sum + count, 0);
    
    detailsDiv.innerHTML = `
        <p><strong>Nombre:</strong> ${appointment.name}</p>
        <p><strong>Fecha:</strong> ${formattedDate}</p>
        <p><strong>Horario:</strong> ${appointment.time}</p>
        <p><strong>Número de turno:</strong> #${appointment.id}</p>
        <div class="stats-update">
            <hr style="margin: 15px 0; border: 1px solid #e1e5e9;">
            <h4 style="color: #667eea; margin-bottom: 10px;">📊 Estadísticas Actualizadas</h4>
            <p><strong>Turnos para este día:</strong> <span style="color: #28a745; font-weight: bold;">${turnosHoy}</span></p>
            <p><strong>Total de turnos:</strong> <span style="color: #667eea; font-weight: bold;">${totalTurnos}</span></p>
        </div>
    `;
    
    modal.style.display = 'block';
    
    // Agregar efecto visual de actualización a las estadísticas
    setTimeout(() => {
        highlightStatsUpdate();
    }, 1000);
}

function closeModal() {
    document.getElementById('confirmationModal').style.display = 'none';
}

function displayAppointments() {
    const container = document.getElementById('appointmentsContainer');
    const today = new Date().toISOString().split('T')[0];
    
    // Filtrar turnos de hoy y futuros, ordenados por fecha y hora
    const upcomingAppointments = appointments
        .filter(apt => apt.date >= today)
        .sort((a, b) => {
            const dateCompare = new Date(a.date) - new Date(b.date);
            if (dateCompare !== 0) return dateCompare;
            return a.time.localeCompare(b.time);
        });
    
    if (upcomingAppointments.length === 0) {
        container.innerHTML = '<p class="no-appointments">No hay turnos reservados</p>';
        return;
    }
    
    container.innerHTML = upcomingAppointments.map(appointment => {
        const formattedDate = new Date(appointment.date + 'T00:00:00').toLocaleDateString('es-ES', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
        
        const isToday = appointment.date === today;
        const cardClass = isToday ? 'appointment-card today' : 'appointment-card';
        
        return `
            <div class="${cardClass}">
                <div class="appointment-time">${appointment.time}</div>
                <div class="appointment-name">${appointment.name}</div>
                <div class="appointment-date">
                    ${formattedDate}${isToday ? ' (Hoy)' : ''}
                    <button class="btn-delete" onclick="deleteAppointment(${appointment.id})">
                        Cancelar
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function deleteAppointment(appointmentId) {
    if (confirm('¿Estás seguro de que quieres cancelar este turno?')) {
        appointments = appointments.filter(apt => apt.id !== appointmentId);
        localStorage.setItem('appointments', JSON.stringify(appointments));
        displayAppointments();
        loadTimeSlots();
        displayTimeSlotsGrid();
    }
}

function displayTimeSlotsGrid() {
    const gridContainer = document.getElementById('timeSlotsGrid');
    const gridDateInput = document.getElementById('gridDate');
    const selectedDate = gridDateInput.value;
    
    if (!selectedDate) return;
    
    // Obtener turnos ocupados para la fecha seleccionada
    const occupiedSlots = appointments
        .filter(apt => apt.date === selectedDate)
        .map(apt => apt.time);
    
    // Generar la grilla de horarios
    gridContainer.innerHTML = TIME_SLOTS.map(time => {
        const isOccupied = occupiedSlots.includes(time);
        const occupiedAppointment = appointments.find(apt => 
            apt.date === selectedDate && apt.time === time
        );
        
        const className = isOccupied ? 'time-slot occupied' : 'time-slot available';
        const title = isOccupied ? 
            `Ocupado por: ${occupiedAppointment.name}` : 
            'Horario disponible';
        
        return `
            <div class="${className}" title="${title}">
                <div class="slot-time">${time}</div>
                ${isOccupied ? `<div class="slot-name">${occupiedAppointment.name}</div>` : ''}
            </div>
        `;
    }).join('');
}

// Sistema de sincronización en tiempo real
function initializeRealTimeSync() {
    // Escuchar cambios en localStorage de otros tabs/dispositivos
    window.addEventListener('storage', function(e) {
        if (e.key === 'registeredUsers') {
            handleNewUserRegistration();
        }
        if (e.key === 'realTimeUsers') {
            updateRealTimeUsersList();
        }
        if (e.key === 'appointments') {
            handleAppointmentSync();
        }
        if (e.key === 'dailyStats') {
            updateStatistics();
        }
    });
    
    // Actualizar datos cada 5 segundos para sincronización entre dispositivos
    setInterval(syncDataFromStorage, 5000);
    
    // Actualizar lista de usuarios activos cada 30 segundos
    setInterval(updateActiveUsers, 30000);
    updateActiveUsers();
    
    // Inicializar timestamp de última sincronización
    if (!localStorage.getItem('lastSyncTimestamp')) {
        localStorage.setItem('lastSyncTimestamp', Date.now().toString());
    }
}

function handleAppointmentSync() {
    // Cargar turnos actualizados desde localStorage
    const newAppointments = JSON.parse(localStorage.getItem('appointments')) || [];
    const oldCount = appointments.length;
    const newCount = newAppointments.length;
    
    appointments = newAppointments;
    
    // Actualizar interfaz
    displayAppointments();
    displayTimeSlotsGrid();
    loadTimeSlots();
    updateStatistics();
    
    // Mostrar notificación si se agregó un nuevo turno
    if (newCount > oldCount) {
        const newestAppointment = newAppointments[newAppointments.length - 1];
        if (newestAppointment && currentUser && newestAppointment.name !== currentUser.name) {
            showRealTimeNotification(
                `📅 ${newestAppointment.name} reservó turno para las ${newestAppointment.time}`, 
                'info'
            );
        }
    }
}

function syncDataFromStorage() {
    // Verificar si hay cambios desde la última sincronización
    const lastSync = localStorage.getItem('lastSyncTimestamp');
    const currentTime = Date.now().toString();
    
    // Simular sincronización entre dispositivos actualizando timestamp
    const appointmentsString = localStorage.getItem('appointments') || '[]';
    const currentHash = btoa(appointmentsString).slice(0, 10);
    const lastHash = localStorage.getItem('lastAppointmentsHash') || '';
    
    if (currentHash !== lastHash) {
        localStorage.setItem('lastAppointmentsHash', currentHash);
        localStorage.setItem('lastSyncTimestamp', currentTime);
        
        // Disparar evento de sincronización manual
        window.dispatchEvent(new StorageEvent('storage', {
            key: 'appointments',
            newValue: appointmentsString,
            oldValue: appointmentsString
        }));
    }
}

function handleNewUserRegistration() {
    // Mostrar notificación de nuevo usuario registrado
    showRealTimeNotification('👤 ¡Nuevo usuario registrado!', 'success');
    updateRealTimeUsersList();
}

function updateActiveUsers() {
    const now = new Date().getTime();
    const activeThreshold = 5 * 60 * 1000; // 5 minutos
    
    // Limpiar usuarios inactivos
    realTimeUsers = realTimeUsers.filter(user => 
        (now - user.lastActivity) < activeThreshold
    );
    
    // Agregar/actualizar usuario actual si está logueado
    if (currentUser) {
        const existingUserIndex = realTimeUsers.findIndex(u => u.id === currentUser.id);
        const userActivity = {
            id: currentUser.id,
            name: currentUser.name,
            email: currentUser.email,
            lastActivity: now,
            deviceId: getDeviceId()
        };
        
        if (existingUserIndex >= 0) {
            realTimeUsers[existingUserIndex] = userActivity;
        } else {
            realTimeUsers.push(userActivity);
        }
        
        localStorage.setItem('realTimeUsers', JSON.stringify(realTimeUsers));
    }
    
    updateRealTimeUsersList();
}

function getDeviceId() {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
        deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        localStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
}

function updateRealTimeUsersList() {
    // Actualizar contador de usuarios en línea
    const onlineCount = realTimeUsers.length;
    updateOnlineUsersDisplay(onlineCount);
}

function updateOnlineUsersDisplay(count) {
    let onlineIndicator = document.getElementById('onlineUsersIndicator');
    
    if (!onlineIndicator) {
        // Crear indicador si no existe
        onlineIndicator = document.createElement('div');
        onlineIndicator.id = 'onlineUsersIndicator';
        onlineIndicator.className = 'online-users-indicator';
        
        const header = document.querySelector('.header-content');
        header.appendChild(onlineIndicator);
    }
    
    onlineIndicator.innerHTML = `
        <div class="online-status">
            <span class="online-dot"></span>
            <span class="online-text">${count} usuario${count !== 1 ? 's' : ''} conectado${count !== 1 ? 's' : ''}</span>
            <div class="online-users-list" id="onlineUsersList">
                ${realTimeUsers.map(user => `
                    <div class="online-user ${user.id === currentUser?.id ? 'current-user' : ''}">
                        <span class="user-avatar">👤</span>
                        <span class="user-name">${user.name}</span>
                        ${user.id === currentUser?.id ? '<span class="you-label">(Tú)</span>' : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function showRealTimeNotification(message, type = 'info') {
    // Crear notificación flotante
    const notification = document.createElement('div');
    notification.className = `real-time-notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            ${message}
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Mostrar con animación
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    // Ocultar después de 4 segundos
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 4000);
}

// Funciones de autenticación manual
function checkAuthenticationStatus() {
    const currentSession = localStorage.getItem('currentUser');
    
    if (currentSession) {
        currentUser = JSON.parse(currentSession);
        showAuthenticatedView();
    } else {
        showUnauthenticatedView();
    }
}

function initializeAuthSystem() {
    // Configurar event listeners para los formularios
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    
    // Cerrar modales al hacer clic fuera
    document.addEventListener('click', function(event) {
        const modals = document.querySelectorAll('.auth-modal');
        modals.forEach(modal => {
            if (event.target === modal) {
                closeAuthModals();
            }
        });
    });
}

function handleRegister(event) {
    event.preventDefault();
    
    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    // Validaciones
    if (password !== confirmPassword) {
        showError('registerError', 'Las contraseñas no coinciden');
        return;
    }
    
    if (password.length < 6) {
        showError('registerError', 'La contraseña debe tener al menos 6 caracteres');
        return;
    }
    
    // Verificar si el email ya existe
    const users = JSON.parse(localStorage.getItem('registeredUsers')) || [];
    if (users.find(user => user.email === email)) {
        showError('registerError', 'Este email ya está registrado');
        return;
    }
    
    // Crear nuevo usuario
    const newUser = {
        id: 'user_' + Date.now(),
        name: name,
        email: email,
        password: password, // En un sistema real, esto estaría encriptado
        registeredAt: new Date().toISOString()
    };
    
    users.push(newUser);
    localStorage.setItem('registeredUsers', JSON.stringify(users));
    
    // Notificar nuevo registro en tiempo real
    broadcastNewUserRegistration(newUser);
    
    showSuccess('registerSuccess', 'Registro exitoso! Ahora puedes iniciar sesión');
    
    // Limpiar formulario
    document.getElementById('registerForm').reset();
    hideError('registerError');
    
    // Cambiar a login después de 2 segundos
    setTimeout(() => {
        switchToLogin();
    }, 2000);
}

function handleLogin(event) {
    event.preventDefault();
    
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    // Buscar usuario
    const users = JSON.parse(localStorage.getItem('registeredUsers')) || [];
    const user = users.find(u => u.email === email && u.password === password);
    
    if (!user) {
        showError('loginError', 'Email o contraseña incorrectos');
        return;
    }
    
    // Iniciar sesión
    currentUser = {
        id: user.id,
        name: user.name,
        email: user.email
    };
    
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    
    // Registrar sesión de login
    const loginHistory = JSON.parse(localStorage.getItem('loginHistory')) || [];
    loginHistory.push({
        userId: user.id,
        email: user.email,
        name: user.name,
        loginTime: new Date().toISOString()
    });
    localStorage.setItem('loginHistory', JSON.stringify(loginHistory));
    
    // Actualizar usuarios activos inmediatamente
    updateActiveUsers();
    
    closeAuthModals();
    showAuthenticatedView();
    
    // Limpiar formulario
    document.getElementById('loginForm').reset();
    hideError('loginError');
}

function showError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    errorElement.textContent = message;
    errorElement.style.display = 'block';
}

function hideError(elementId) {
    const errorElement = document.getElementById(elementId);
    errorElement.style.display = 'none';
}

function showSuccess(elementId, message) {
    const successElement = document.getElementById(elementId);
    successElement.textContent = message;
    successElement.style.display = 'block';
}

function showAuthenticatedView() {
    document.getElementById('userInfo').style.display = 'flex';
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('bookingForm').style.display = 'block';
    document.getElementById('appointmentsList').style.display = 'block';
    
    document.getElementById('welcomeText').textContent = `¡Hola, ${currentUser.name}!`;
    
    // Pre-llenar el nombre en el formulario de turnos
    const userNameField = document.getElementById('userName');
    if (userNameField) {
        userNameField.value = currentUser.name;
        userNameField.readOnly = true;
        userNameField.style.backgroundColor = '#f8f9fa';
    }
    
    // Configurar evento de logout
    const logoutBtn = document.getElementById('logoutBtn');
    logoutBtn.removeEventListener('click', logout); // Remover listeners previos
    logoutBtn.addEventListener('click', logout);
    
    // Inicializar la aplicación normalmente
    initializeDateInput();
    initializeGridDate();
    loadTimeSlots();
    displayAppointments();
    displayTimeSlotsGrid();
    setupEventListeners();
    
    // Inicializar estadísticas
    document.getElementById('statsPeriod').addEventListener('change', updateStatistics);
    updateStatistics();
}

function showUnauthenticatedView() {
    document.getElementById('userInfo').style.display = 'none';
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('bookingForm').style.display = 'none';
    document.getElementById('appointmentsList').style.display = 'none';
}

function logout() {
    // Registrar logout
    if (currentUser) {
        const loginHistory = JSON.parse(localStorage.getItem('loginHistory')) || [];
        const lastLogin = loginHistory[loginHistory.length - 1];
        if (lastLogin && lastLogin.userId === currentUser.id) {
            lastLogin.logoutTime = new Date().toISOString();
            localStorage.setItem('loginHistory', JSON.stringify(loginHistory));
        }
    }
    
    localStorage.removeItem('currentUser');
    currentUser = null;
    
    // Limpiar de usuarios activos
    realTimeUsers = realTimeUsers.filter(u => u.id !== currentUser?.id);
    localStorage.setItem('realTimeUsers', JSON.stringify(realTimeUsers));
    
    showUnauthenticatedView();
}

function showLoginModal() {
    closeAuthModals();
    document.getElementById('loginModal').style.display = 'block';
    hideError('loginError');
}

function showRegisterModal() {
    closeAuthModals();
    document.getElementById('registerModal').style.display = 'block';
    hideError('registerError');
    hideError('registerSuccess');
}

function closeAuthModals() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('registerModal').style.display = 'none';
}

function switchToLogin() {
    closeAuthModals();
    showLoginModal();
}

function switchToRegister() {
    closeAuthModals();
    showRegisterModal();
}

// Función para ver el historial de logins (para administradores)
function getLoginHistory() {
    return JSON.parse(localStorage.getItem('loginHistory')) || [];
}

// Función para ver usuarios registrados (para administradores)
function getRegisteredUsers() {
    return JSON.parse(localStorage.getItem('registeredUsers')) || [];
}

function broadcastNewUserRegistration(newUser) {
    // Crear evento personalizado para notificar nuevo registro
    const event = new CustomEvent('newUserRegistered', {
        detail: {
            name: newUser.name,
            email: newUser.email,
            timestamp: new Date().toISOString()
        }
    });
    
    // Disparar evento
    window.dispatchEvent(event);
    
    // También podemos mostrar notificación local
    setTimeout(() => {
        showRealTimeNotification(`🎉 ¡${newUser.name} se acaba de registrar!`, 'success');
    }, 1000);
}

// Funciones de estadísticas
function updateDailyStats(date) {
    if (!dailyStats[date]) {
        dailyStats[date] = 0;
    }
    dailyStats[date]++;
    localStorage.setItem('dailyStats', JSON.stringify(dailyStats));
    updateStatistics();
}

function highlightStatsUpdate() {
    const statisticsSection = document.getElementById('statisticsSection');
    if (statisticsSection) {
        statisticsSection.style.animation = 'statsHighlight 2s ease-in-out';
        statisticsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Remover la animación después de que termine
        setTimeout(() => {
            statisticsSection.style.animation = '';
        }, 2000);
    }
}

function updateStatistics() {
    const period = parseInt(document.getElementById('statsPeriod').value);
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - period);
    
    let totalTurnos = 0;
    let dayCount = 0;
    let maxTurnos = 0;
    let dayWithMostTurnos = '';
    let chartData = [];
    
    // Generar datos para el período seleccionado
    for (let i = 0; i < period; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);
        const dateStr = currentDate.toISOString().split('T')[0];
        const turnos = dailyStats[dateStr] || 0;
        
        totalTurnos += turnos;
        if (turnos > 0) dayCount++;
        
        if (turnos > maxTurnos) {
            maxTurnos = turnos;
            dayWithMostTurnos = currentDate.toLocaleDateString('es-ES', {
                weekday: 'short',
                day: 'numeric',
                month: 'short'
            });
        }
        
        chartData.push({
            date: dateStr,
            displayDate: currentDate.toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit'
            }),
            turnos: turnos
        });
    }
    
    const promedio = dayCount > 0 ? (totalTurnos / period).toFixed(1) : 0;
    
    // Actualizar elementos de resumen
    document.getElementById('totalTurnos').textContent = totalTurnos;
    document.getElementById('promedioDiario').textContent = promedio;
    document.getElementById('diaMasTurnos').textContent = dayWithMostTurnos || 'N/A';
    
    // Generar gráfico
    generateChart(chartData);
    
    // Generar tabla de detalles
    generateStatsTable(chartData);
}

function generateChart(data) {
    const chartContainer = document.getElementById('dailyStatsChart');
    const maxValue = Math.max(...data.map(d => d.turnos), 1);
    
    chartContainer.innerHTML = data.map(day => {
        const height = (day.turnos / maxValue) * 100;
        const barClass = day.turnos > 0 ? 'chart-bar active' : 'chart-bar';
        
        return `
            <div class="chart-day">
                <div class="${barClass}" style="height: ${height}%" title="${day.turnos} turnos el ${day.displayDate}">
                    <span class="bar-value">${day.turnos > 0 ? day.turnos : ''}</span>
                </div>
                <div class="chart-label">${day.displayDate}</div>
            </div>
        `;
    }).join('');
}

function generateStatsTable(data) {
    const tableContainer = document.getElementById('dailyStatsTable');
    const recentData = data.slice(-14).reverse(); // Últimos 14 días, más recientes primero
    
    if (recentData.every(day => day.turnos === 0)) {
        tableContainer.innerHTML = '<p class="no-stats">No hay datos para mostrar en este período</p>';
        return;
    }
    
    tableContainer.innerHTML = `
        <div class="stats-table-header">
            <div>Fecha</div>
            <div>Turnos</div>
            <div>Tendencia</div>
        </div>
        ${recentData.map((day, index) => {
            const previousDay = recentData[index + 1];
            let trend = '─';
            let trendClass = 'trend-equal';
            
            if (previousDay) {
                if (day.turnos > previousDay.turnos) {
                    trend = '↗';
                    trendClass = 'trend-up';
                } else if (day.turnos < previousDay.turnos) {
                    trend = '↘';
                    trendClass = 'trend-down';
                }
            }
            
            const rowClass = day.turnos > 0 ? 'stats-row active' : 'stats-row';
            const formattedDate = new Date(day.date + 'T00:00:00').toLocaleDateString('es-ES', {
                weekday: 'short',
                day: '2-digit',
                month: '2-digit'
            });
            
            return `
                <div class="${rowClass}">
                    <div>${formattedDate}</div>
                    <div class="turnos-count">${day.turnos}</div>
                    <div class="trend ${trendClass}">${trend}</div>
                </div>
            `;
        }).join('')}
    `;
}

function deleteAppointment(appointmentId) {
    if (confirm('¿Estás seguro de que quieres cancelar este turno?')) {
        const appointment = appointments.find(apt => apt.id === appointmentId);
        if (appointment) {
            // Actualizar estadísticas (restar uno)
            if (dailyStats[appointment.date] && dailyStats[appointment.date] > 0) {
                dailyStats[appointment.date]--;
                if (dailyStats[appointment.date] === 0) {
                    delete dailyStats[appointment.date];
                }
                localStorage.setItem('dailyStats', JSON.stringify(dailyStats));
            }
        }
        
        appointments = appointments.filter(apt => apt.id !== appointmentId);
        localStorage.setItem('appointments', JSON.stringify(appointments));
        displayAppointments();
        loadTimeSlots();
        displayTimeSlotsGrid();
        updateStatistics();
    }
}

// Actualizar la lista cada minuto para mostrar cambios en tiempo real
setInterval(() => {
    if (currentUser) {
        displayAppointments();
    }
}, 60000);
