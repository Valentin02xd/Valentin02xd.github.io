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

    // Enviar señal de sincronización
    broadcastSyncSignal('appointment_created');

    // Notificación para el usuario actual
    setTimeout(() => {
        showRealTimeNotification(
            `✅ Tu turno para las ${appointment.time} ha sido confirmado`, 
            'success'
        );

        // Resaltar el slot reservado
        highlightTimeSlot(appointment.time);
    }, 500);
}

function highlightTimeSlot(time) {
    const slots = document.querySelectorAll('.time-slot');
    slots.forEach(slot => {
        const slotTime = slot.querySelector('.slot-time');
        if (slotTime && slotTime.textContent === time) {
            slot.style.animation = 'slotHighlight 2s ease-in-out';
            setTimeout(() => {
                slot.style.animation = '';
            }, 2000);
        }
    });
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

    modal.style.display = 'flex';
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

    modal.style.display = 'flex';

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
        if (e.key === 'syncSignal') {
            handleSyncSignal(e.newValue);
        }
    });

    // Sincronización más frecuente para mejor tiempo real
    setInterval(syncDataFromStorage, 2000);
    setInterval(forceSyncCheck, 1000);

    // Actualizar lista de usuarios activos cada 15 segundos
    setInterval(updateActiveUsers, 15000);
    updateActiveUsers();

    // Inicializar timestamp de última sincronización
    if (!localStorage.getItem('lastSyncTimestamp')) {
        localStorage.setItem('lastSyncTimestamp', Date.now().toString());
    }

    // Señal de sincronización inicial
    broadcastSyncSignal('page_loaded');
}

function handleAppointmentSync() {
    // Cargar turnos actualizados desde localStorage
    const newAppointments = JSON.parse(localStorage.getItem('appointments')) || [];
    const oldAppointments = [...appointments];
    const oldCount = appointments.length;
    const newCount = newAppointments.length;

    // Detectar cambios específicos
    const addedAppointments = newAppointments.filter(newApt => 
        !oldAppointments.find(oldApt => oldApt.id === newApt.id)
    );

    const removedAppointments = oldAppointments.filter(oldApt => 
        !newAppointments.find(newApt => newApt.id === oldApt.id)
    );

    appointments = newAppointments;

    // Actualizar interfaz
    displayAppointments();
    displayTimeSlotsGrid();
    loadTimeSlots();
    updateStatistics();

    // Notificar cambios específicos
    addedAppointments.forEach(appointment => {
        if (currentUser && appointment.userEmail !== currentUser.email) {
            const appointmentDate = new Date(appointment.date + 'T00:00:00');
            const isToday = appointment.date === new Date().toISOString().split('T')[0];
            const dateText = isToday ? 'hoy' : appointmentDate.toLocaleDateString('es-ES', {
                weekday: 'short',
                day: 'numeric',
                month: 'short'
            });

            showRealTimeNotification(
                `📅 ${appointment.name} reservó turno para las ${appointment.time} ${dateText}`, 
                'info'
            );

            // Resaltar el slot afectado
            setTimeout(() => {
                highlightTimeSlot(appointment.time);
            }, 500);
        }
    });

    removedAppointments.forEach(appointment => {
        if (currentUser && appointment.userEmail !== currentUser.email) {
            showRealTimeNotification(
                `❌ Se canceló el turno de las ${appointment.time}`, 
                'warning'
            );
        }
    });

    // Actualizar contador conocido
    localStorage.setItem('lastKnownAppointmentCount', newCount.toString());
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

function forceSyncCheck() {
    // Verificación más agresiva de cambios
    const currentAppointments = JSON.parse(localStorage.getItem('appointments')) || [];
    const currentCount = currentAppointments.length;
    const lastKnownCount = parseInt(localStorage.getItem('lastKnownAppointmentCount')) || 0;

    if (currentCount !== lastKnownCount) {
        localStorage.setItem('lastKnownAppointmentCount', currentCount.toString());
        handleAppointmentSync();
        broadcastSyncSignal('appointment_change');
    }
}

function broadcastSyncSignal(action) {
    const signal = {
        action: action,
        timestamp: Date.now(),
        userId: currentUser?.id || 'anonymous',
        sessionId: getSessionId()
    };

    localStorage.setItem('syncSignal', JSON.stringify(signal));

    // Limpiar la señal después de un momento
    setTimeout(() => {
        localStorage.removeItem('syncSignal');
    }, 1000);
}

function handleSyncSignal(signalData) {
    if (!signalData) return;

    try {
        const signal = JSON.parse(signalData);
        const sessionId = getSessionId();

        // No procesar señales de la misma sesión
        if (signal.sessionId === sessionId) return;

        switch (signal.action) {
            case 'appointment_created':
                showRealTimeNotification('🔄 Datos actualizados desde otro dispositivo', 'info');
                handleAppointmentSync();
                break;
            case 'user_login':
                showRealTimeNotification('👤 Usuario conectado desde otro dispositivo', 'info');
                updateActiveUsers();
                break;
            case 'page_loaded':
                handleAppointmentSync();
                break;
        }
    } catch (e) {
        console.error('Error procesando señal de sincronización:', e);
    }
}

function getSessionId() {
    let sessionId = sessionStorage.getItem('sessionId');
    if (!sessionId) {
        sessionId = 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        sessionStorage.setItem('sessionId', sessionId);
    }
    return sessionId;
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

    // Notificar login en otros dispositivos
    broadcastSyncSignal('user_login');

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

function logSupportRequest(userName, userEmail, timestamp) {
    const supportRequests = JSON.parse(localStorage.getItem('supportRequests')) || [];
    
    const newRequest = {
        id: 'support_' + Date.now(),
        userName: userName,
        userEmail: userEmail,
        timestamp: timestamp,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    
    supportRequests.push(newRequest);
    localStorage.setItem('supportRequests', JSON.stringify(supportRequests));
    
    // Notificar al equipo interno sobre la nueva solicitud
    broadcastSupportRequest(newRequest);
}

function broadcastSupportRequest(request) {
    // Crear evento para notificar nueva solicitud de soporte
    const event = new CustomEvent('supportRequestCreated', {
        detail: {
            userName: request.userName,
            userEmail: request.userEmail,
            timestamp: request.timestamp
        }
    });

    window.dispatchEvent(event);
}

// Funciones del asistente IA
function showAIAssistant() {
    document.getElementById('aiChatContainer').style.display = 'flex';
    updateInitialAIMessage();
}

function updateInitialAIMessage() {
    const initialMessage = document.getElementById('initialAIMessage');
    if (!initialMessage) return;
    
    const userInfo = getUserContextInfo();
    const pageStats = getPageStatistics();
    
    let welcomeMessage = '';
    let quickActions = '';
    
    if (currentUser) {
        welcomeMessage = `¡Hola ${currentUser.name}! 👋 Soy TurnoBot, tu asistente personal para TurnoTech.
        <br><br>📊 <strong>Tu resumen:</strong>
        <br>• Turnos activos: ${userInfo.userAppointments}
        <br>• Próximo turno: ${userInfo.nextAppointment}
        <br>• Horarios disponibles hoy: ${pageStats.availableToday}`;
        
        if (userInfo.userAppointments > 0) {
            quickActions = `
                <button onclick="askAI('Ver mis turnos')">📋 Ver mis turnos</button>
                <button onclick="askAI('¿Cómo cancelo mi turno?')">❌ Cancelar turno</button>
                <button onclick="askAI('Reservar nuevo turno')">➕ Reservar nuevo turno</button>
                <button onclick="askAI('Ver estadísticas')">📊 Ver estadísticas</button>`;
        } else {
            quickActions = `
                <button onclick="askAI('¿Cómo reservo un turno?')">📅 Reservar mi primer turno</button>
                <button onclick="askAI('Ver horarios disponibles')">🕐 Ver horarios disponibles</button>
                <button onclick="askAI('Ver estadísticas')">📊 Ver estadísticas del sistema</button>
                <button onclick="contactSupport()">📞 Contactar soporte técnico</button>`;
        }
    } else {
        welcomeMessage = `¡Hola! 👋 Soy TurnoBot, el asistente IA de TurnoTech.
        <br><br>📊 <strong>Estado del sistema:</strong>
        <br>• Usuarios en línea: ${pageStats.onlineUsers}
        <br>• Horarios disponibles hoy: ${pageStats.availableToday}
        <br>• Total de usuarios registrados: ${pageStats.totalUsers}
        <br><br>Para acceder a todas las funciones, te recomiendo registrarte e iniciar sesión.`;
        
        quickActions = `
            <button onclick="askAI('¿Cómo me registro?')">👤 ¿Cómo me registro?</button>
            <button onclick="askAI('Ver horarios disponibles')">🕐 Ver horarios</button>
            <button onclick="askAI('¿Qué es TurnoTech?')">ℹ️ ¿Qué es TurnoTech?</button>
            <button onclick="contactSupport()">📞 Contactar soporte técnico</button>`;
    }
    
    welcomeMessage += `<br><br>💬 ¿En qué puedo ayudarte específicamente?`;
    
    initialMessage.innerHTML = `${welcomeMessage}
        <div class="ai-quick-actions">${quickActions}</div>`;
}

function closeAIAssistant() {
    document.getElementById('aiChatContainer').style.display = 'none';
    
    // Mostrar mensaje de despedida personalizado
    if (currentUser) {
        showRealTimeNotification(`👋 ¡Hasta luego ${currentUser.name}! TurnoBot siempre está aquí para ayudarte.`, 'info');
    } else {
        showRealTimeNotification('👋 ¡Hasta luego! Registrate para obtener ayuda personalizada.', 'info');
    }
}

function handleAIEnter(event) {
    if (event.key === 'Enter') {
        sendAIMessage();
    }
}

function sendAIMessage() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    addUserMessage(message);
    input.value = '';
    
    // Simular respuesta del AI después de un delay
    setTimeout(() => {
        const response = getAIResponse(message);
        addAIMessage(response);
    }, 1000);
}

function askAI(question) {
    addUserMessage(question);
    
    setTimeout(() => {
        const response = getAIResponse(question);
        addAIMessage(response);
    }, 1000);
}

function addUserMessage(message) {
    const messagesContainer = document.getElementById('aiChatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'user-message';
    messageDiv.innerHTML = `
        <div class="user-avatar">👤</div>
        <div class="user-text">${message}</div>
    `;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addAIMessage(message) {
    const messagesContainer = document.getElementById('aiChatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'ai-message';
    messageDiv.innerHTML = `
        <div class="ai-avatar">🤖</div>
        <div class="ai-text">${message}</div>
    `;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function getAIResponse(message) {
    const lowerMessage = message.toLowerCase();
    
    // Obtener información del usuario y estado de la página
    const userInfo = getUserContextInfo();
    const pageStats = getPageStatistics();
    
    // Respuestas para comandos especiales
    if (lowerMessage.includes('cerrar') || lowerMessage.includes('salir') || lowerMessage.includes('adiós') || lowerMessage.includes('bye')) {
        let farewell = '';
        if (currentUser) {
            farewell = `¡Hasta luego ${currentUser.name}! Ha sido un placer ayudarte. 😊`;
        } else {
            farewell = '¡Hasta luego! Espero haberte sido útil. 😊';
        }
        
        setTimeout(() => {
            closeAIAssistant();
        }, 2000);
        
        return farewell;
    }
    
    if (lowerMessage.includes('reservo') || lowerMessage.includes('turno')) {
        let response = '';
        
        if (currentUser) {
            response = `¡Hola ${currentUser.name}! Para reservar un turno:
            <br>1. ✅ Ya estás registrado e iniciaste sesión
            <br>2. Completa el formulario con la fecha deseada
            <br>3. Selecciona un horario disponible
            <br>4. Haz clic en "Reservar Turno"
            <br><br>📊 <strong>Información actual:</strong>
            <br>• Turnos disponibles hoy: ${pageStats.availableToday}
            <br>• Tus turnos activos: ${userInfo.userAppointments}`;
            
            if (userInfo.userAppointments > 0) {
                response += `<br>• Tu próximo turno: ${userInfo.nextAppointment}`;
            }
        } else {
            response = `Para reservar un turno necesitas:
            <br>1. ❌ Registrarte e iniciar sesión primero
            <br>2. Completar el formulario con tu nombre y fecha
            <br>3. Seleccionar un horario disponible
            <br>4. Hacer clic en "Reservar Turno"
            <br><br>📊 <strong>Información actual:</strong>
            <br>• Turnos disponibles hoy: ${pageStats.availableToday}
            <br>• Total usuarios en línea: ${pageStats.onlineUsers}
            <br><br>¿Necesitas ayuda para registrarte?`;
        }
        
        return response;
    }
    
    if (lowerMessage.includes('cancelo') || lowerMessage.includes('cancelar')) {
        let response = '';
        
        if (currentUser) {
            if (userInfo.userAppointments > 0) {
                response = `¡Hola ${currentUser.name}! Para cancelar tu turno:
                <br>1. Ve a la sección "Turnos Reservados"
                <br>2. Busca tu turno en la lista
                <br>3. Haz clic en el botón "Cancelar" rojo
                <br>4. Confirma la cancelación
                <br><br>📋 <strong>Tus turnos actuales:</strong>
                <br>• Turnos activos: ${userInfo.userAppointments}
                <br>• Próximo turno: ${userInfo.nextAppointment}
                <br><br>El horario quedará disponible automáticamente para otros usuarios.`;
            } else {
                response = `¡Hola ${currentUser.name}! Actualmente no tienes turnos reservados para cancelar.
                <br><br>¿Te gustaría reservar un nuevo turno?`;
            }
        } else {
            response = `Para cancelar turnos necesitas iniciar sesión primero.
            <br><br>Si ya tienes una cuenta, inicia sesión y podrás ver y cancelar tus turnos.`;
        }
        
        return response;
    }
    
    if (lowerMessage.includes('registro') || lowerMessage.includes('cuenta')) {
        if (currentUser) {
            return `¡Hola ${currentUser.name}! Ya tienes una cuenta registrada y has iniciado sesión.
            <br><br>📊 <strong>Tu información:</strong>
            <br>• Email: ${currentUser.email}
            <br>• Turnos reservados: ${userInfo.userAppointments}
            <br>• Miembro desde: ${userInfo.memberSince}
            <br><br>¿Hay algo específico que necesites hacer con tu cuenta?`;
        } else {
            return `Para registrarte en TurnoTech:
            <br>1. Haz clic en "Registrarse" en la esquina superior derecha
            <br>2. Completa el formulario con tus datos
            <br>3. Tu contraseña debe tener al menos 6 caracteres
            <br>4. Confirma tu contraseña
            <br>5. Haz clic en "Registrarse"
            <br><br>📊 <strong>Estadísticas del sistema:</strong>
            <br>• Usuarios registrados: ${pageStats.totalUsers}
            <br>• Usuarios en línea: ${pageStats.onlineUsers}
            <br><br>¡Después podrás iniciar sesión inmediatamente!`;
        }
    }
    
    if (lowerMessage.includes('horario') || lowerMessage.includes('disponible')) {
        let response = `📅 <strong>Sistema de Horarios TurnoTech</strong>
        <br>Los horarios disponibles van desde las 08:00 hasta las 19:00 horas.
        <br><br>🎨 <strong>En el estado de horarios puedes ver:</strong>
        <br>• 🟢 Verde: Horarios disponibles
        <br>• 🔴 Rojo: Horarios ocupados (con el nombre de la persona)
        <br><br>📊 <strong>Estado actual:</strong>
        <br>• Horarios disponibles hoy: ${pageStats.availableToday}
        <br>• Total de turnos registrados: ${pageStats.totalAppointments}
        <br>• Promedio diario: ${pageStats.dailyAverage} turnos`;
        
        if (currentUser) {
            response += `<br><br>👤 <strong>Tu información:</strong>
            <br>• Tus turnos activos: ${userInfo.userAppointments}`;
            if (userInfo.userAppointments > 0) {
                response += `<br>• Próximo turno: ${userInfo.nextAppointment}`;
            }
        }
        
        return response;
    }
    
    if (lowerMessage.includes('estadística') || lowerMessage.includes('datos') || lowerMessage.includes('estadísticas')) {
        let response = `📊 <strong>Estadísticas de TurnoTech</strong>
        <br><br>🎯 <strong>Datos generales:</strong>
        <br>• Total de turnos: ${pageStats.totalAppointments}
        <br>• Promedio diario: ${pageStats.dailyAverage}
        <br>• Usuarios registrados: ${pageStats.totalUsers}
        <br>• Usuarios en línea: ${pageStats.onlineUsers}
        <br>• Horarios disponibles hoy: ${pageStats.availableToday}`;
        
        if (currentUser) {
            response += `<br><br>👤 <strong>Tus estadísticas:</strong>
            <br>• Turnos reservados: ${userInfo.userAppointments}
            <br>• Miembro desde: ${userInfo.memberSince}`;
        }
        
        return response;
    }
    
    if (lowerMessage.includes('problema') || lowerMessage.includes('error') || lowerMessage.includes('ayuda')) {
        let response = '';
        
        if (currentUser) {
            response = `¡Hola ${currentUser.name}! Estoy aquí para ayudarte. 🛠️`;
        } else {
            response = `¡Hola! Estoy aquí para ayudarte. 🛠️`;
        }
        
        response += `<br><br>🔧 <strong>Puedo ayudarte con:</strong>
        <br>• Problemas de registro o inicio de sesión
        <br>• Dificultades para reservar turnos
        <br>• Preguntas sobre el funcionamiento de TurnoTech
        <br>• Explicar las estadísticas del sistema
        <br>• Errores o bugs en la aplicación
        <br><br>📊 <strong>Estado del sistema:</strong>
        <br>• Sistema funcionando: ✅ Normal
        <br>• Usuarios en línea: ${pageStats.onlineUsers}
        <br>• Última actualización: ${pageStats.lastUpdate}
        <br><br>Para problemas más complejos:
        <br><button onclick="contactSupport()" style="background: #ff9800; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer;">📧 Contactar Soporte Técnico</button>`;
        
        return response;
    }
    
    if (lowerMessage.includes('soporte') || lowerMessage.includes('contacto') || lowerMessage.includes('técnico')) {
        let response = '';
        
        if (currentUser) {
            response = `¡Hola ${currentUser.name}! Te conectaré con nuestro equipo de soporte técnico:`;
        } else {
            response = `Te conectaré con nuestro equipo de soporte técnico:`;
        }
        
        response += `<br><br>👥 <strong>Equipo TurnoTech:</strong>
        <br>• Brandon Areco - Desarrollador Principal
        <br>• Elías Agüero - Desarrollador Backend  
        <br>• Santino Olariaga - Desarrollador Frontend
        <br>• Jeremías Ledezma - Desarrollador Full Stack
        <br><br><button onclick="contactSupport()" style="background: #ff9800; color: white; border: none; padding: 10px 15px; border-radius: 6px; cursor: pointer; margin-top: 10px; font-weight: bold;">📧 Notificar al Equipo Completo</button>
        <br><br>Al hacer clic, se enviará automáticamente un email a todo nuestro equipo técnico con tu información y consulta.
        <br><br>💡 <em>También puedes contactarlos directamente desde el botón de soporte en la esquina inferior derecha.</em>`;
        
        return response;
    }
    
    if (lowerMessage.includes('información') || lowerMessage.includes('sobre') || lowerMessage.includes('qué es')) {
        let response = `🏢 <strong>Sobre TurnoTech</strong>
        <br><br>TurnoTech es un sistema avanzado de gestión de turnos para la Sala de Informática, diseñado para optimizar el uso de recursos y mejorar la experiencia de los usuarios.
        <br><br>🚀 <strong>Características:</strong>
        <br>• Sistema de reservas en tiempo real
        <br>• Autenticación segura de usuarios
        <br>• Estadísticas detalladas de uso
        <br>• Asistente IA integrado (¡soy yo! 🤖)
        <br>• Soporte técnico especializado
        <br>• Sincronización multi-dispositivo
        <br><br>📊 <strong>Estado actual:</strong>
        <br>• Usuarios registrados: ${pageStats.totalUsers}
        <br>• Turnos procesados: ${pageStats.totalAppointments}
        <br>• Disponibilidad: 99.9% ⚡`;
        
        if (currentUser) {
            response += `<br><br>👤 <strong>Tu sesión:</strong>
            <br>• Conectado como: ${currentUser.name}
            <br>• Email: ${currentUser.email}`;
        }
        
        return response;
    }
    
    // Respuesta por defecto personalizada
    let defaultResponse = '';
    
    if (currentUser) {
        defaultResponse = `¡Hola ${currentUser.name}! 👋 Soy TurnoBot, tu asistente personal para TurnoTech.`;
    } else {
        defaultResponse = `¡Hola! 👋 Soy TurnoBot, el asistente IA de TurnoTech.`;
    }
    
    defaultResponse += `<br><br>🤖 <strong>Puedo ayudarte con:</strong>
    <br>• 📅 Reservar y cancelar turnos
    <br>• 👤 Registro e inicio de sesión
    <br>• 📊 Información sobre horarios y estadísticas
    <br>• 🛠️ Problemas técnicos y soporte
    <br>• ℹ️ Información general sobre TurnoTech
    <br><br>📊 <strong>Estado actual del sistema:</strong>
    <br>• Horarios disponibles hoy: ${pageStats.availableToday}
    <br>• Usuarios en línea: ${pageStats.onlineUsers}
    <br>• Total de turnos: ${pageStats.totalAppointments}`;
    
    if (currentUser && userInfo.userAppointments > 0) {
        defaultResponse += `<br><br>👤 <strong>Recordatorio:</strong> Tienes ${userInfo.userAppointments} turno(s) reservado(s)`;
    }
    
    defaultResponse += `<br><br>💬 ¿En qué puedo ayudarte específicamente?`;
    
    return defaultResponse;
}

// Función auxiliar para obtener información del contexto del usuario
function getUserContextInfo() {
    if (!currentUser) {
        return {
            userAppointments: 0,
            nextAppointment: 'Ninguno',
            memberSince: 'No registrado'
        };
    }
    
    // Obtener turnos del usuario actual
    const userAppointments = appointments.filter(apt => 
        apt.userEmail === currentUser.email && 
        apt.date >= new Date().toISOString().split('T')[0]
    );
    
    // Obtener el próximo turno
    let nextAppointment = 'Ninguno';
    if (userAppointments.length > 0) {
        const sortedAppointments = userAppointments.sort((a, b) => {
            const dateCompare = new Date(a.date) - new Date(b.date);
            if (dateCompare !== 0) return dateCompare;
            return a.time.localeCompare(b.time);
        });
        
        const next = sortedAppointments[0];
        const appointmentDate = new Date(next.date + 'T00:00:00');
        const isToday = next.date === new Date().toISOString().split('T')[0];
        const dateText = isToday ? 'Hoy' : appointmentDate.toLocaleDateString('es-ES', {
            weekday: 'short',
            day: 'numeric',
            month: 'short'
        });
        
        nextAppointment = `${dateText} a las ${next.time}`;
    }
    
    // Obtener fecha de registro
    const users = JSON.parse(localStorage.getItem('registeredUsers')) || [];
    const user = users.find(u => u.email === currentUser.email);
    let memberSince = 'Fecha no disponible';
    if (user && user.registeredAt) {
        const regDate = new Date(user.registeredAt);
        memberSince = regDate.toLocaleDateString('es-ES', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    }
    
    return {
        userAppointments: userAppointments.length,
        nextAppointment: nextAppointment,
        memberSince: memberSince
    };
}

// Función auxiliar para obtener estadísticas de la página
function getPageStatistics() {
    const today = new Date().toISOString().split('T')[0];
    const todayAppointments = appointments.filter(apt => apt.date === today);
    const availableToday = TIME_SLOTS.length - todayAppointments.length;
    
    const users = JSON.parse(localStorage.getItem('registeredUsers')) || [];
    const onlineUsers = realTimeUsers.length;
    
    // Calcular promedio diario
    const totalDays = Object.keys(dailyStats).length || 1;
    const totalAppointments = Object.values(dailyStats).reduce((sum, count) => sum + count, 0);
    const dailyAverage = (totalAppointments / totalDays).toFixed(1);
    
    return {
        availableToday: availableToday,
        totalUsers: users.length,
        onlineUsers: onlineUsers,
        totalAppointments: appointments.length,
        dailyAverage: dailyAverage,
        lastUpdate: new Date().toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
        })
    };
}

function contactSupport() {
    // Enviar notificación automática al equipo de soporte
    sendSupportNotification();
    
    closeAIAssistant();
    setTimeout(() => {
        showSupportModal();
        showRealTimeNotification('📧 Hemos notificado al equipo de soporte técnico sobre tu consulta', 'success');
    }, 300);
}

function sendSupportNotification() {
    const userInfo = currentUser ? currentUser.name : 'Usuario anónimo';
    const userEmail = currentUser ? currentUser.email : 'No registrado';
    const timestamp = new Date().toLocaleString('es-ES');
    
    // Lista de emails del equipo de soporte
    const supportEmails = [
        'brandonareco02@gmail.com',
        'agueroelias433@gmail.com', 
        'santinoolariaga11@gmail.com',
        'jereledezma871@gmail.com'
    ];
    
    // Crear el contenido del email
    const subject = `🔧 TurnoTech - Solicitud de Soporte Técnico`;
    const body = `Hola equipo de soporte,

Un usuario ha solicitado ayuda técnica en TurnoTech:

👤 Usuario: ${userInfo}
📧 Email: ${userEmail}
🕐 Fecha y hora: ${timestamp}
🌐 Página: Sistema de Turnos - Sala de Informática

El usuario ha contactado desde el asistente IA solicitando ayuda del equipo de soporte técnico.

Por favor, contacten al usuario lo antes posible para brindar asistencia.

---
Este mensaje fue enviado automáticamente desde TurnoTech.`;

    // Abrir cliente de email para cada miembro del equipo de soporte
    supportEmails.forEach((email, index) => {
        setTimeout(() => {
            const mailtoLink = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            
            // Crear un enlace temporal y hacer clic en él
            const link = document.createElement('a');
            link.href = mailtoLink;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }, index * 1000); // Retraso de 1 segundo entre cada email
    });
    
    // Registrar la solicitud de soporte
    logSupportRequest(userInfo, userEmail, timestamp);
}

// Funciones para el modal de soporte técnico
function showSupportModal() {
    document.getElementById('supportModal').style.display = 'block';
}

function closeSupportModal() {
    document.getElementById('supportModal').style.display = 'none';
}

// Cerrar modales al hacer clic fuera de ellos
document.addEventListener('click', function(event) {
    const supportModal = document.getElementById('supportModal');
    const aiChatContainer = document.getElementById('aiChatContainer');
    
    if (event.target === supportModal) {
        closeSupportModal();
    }
    
    if (event.target === aiChatContainer) {
        closeAIAssistant();
    }
});

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
        }        chartData.push({
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