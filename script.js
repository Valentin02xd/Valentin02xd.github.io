// Configuración de horarios
const TIME_SLOTS = [
    '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
    '16:00', '17:00', '18:00', '19:00'
];

// Storage para los turnos
let appointments = [];
let currentUser = null;
let dailyStats = {};

// Inicializar la aplicación
document.addEventListener('DOMContentLoaded', function() {
    initializeAuthSystem();
    initializeDateInput();
    initializeGridDate();
    setupEventListeners();
});

// 1. Firebase Auth State Listener
firebase.auth().onAuthStateChanged(user => {
    if (user) {
        // User is signed in.
        const userRef = database.ref('users/' + user.uid);
        userRef.on('value', (snapshot) => {
            const userProfile = snapshot.val();
            currentUser = {
                uid: user.uid,
                email: user.email,
                name: userProfile ? userProfile.name : 'Usuario'
            };
            showAuthenticatedView();
        });
        initializeRealTimeSync(); // Start real-time sync only when authenticated
    } else {
        // User is signed out.
        currentUser = null;
        showUnauthenticatedView();
    }
});


function initializeDateInput() {
    const dateInput = document.getElementById('appointmentDate');
    const today = new Date();
    const maxDate = new Date('2100-12-31');

    dateInput.min = today.toISOString().split('T')[0];
    dateInput.max = maxDate.toISOString().split('T')[0];
    dateInput.value = today.toISOString().split('T')[0];

    dateInput.addEventListener('change', loadTimeSlots);
}

function initializeGridDate() {
    const gridDateInput = document.getElementById('gridDate');
    const today = new Date();
    const maxDate = new Date('2100-12-31');

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

    timeSelect.innerHTML = '<option value="">Selecciona un horario</option>';

    const occupiedSlots = appointments
        .filter(apt => apt.date === selectedDate)
        .map(apt => ({ time: apt.time, name: apt.name }));

    TIME_SLOTS.forEach(time => {
        const option = document.createElement('option');
        option.value = time;
        const occupiedSlot = occupiedSlots.find(slot => slot.time === time);

        if (occupiedSlot) {
            option.textContent = `${time} - Ocupado por ${occupiedSlot.name}`;
            option.disabled = true;
            option.classList.add('time-slot-occupied');
        } else {
            option.textContent = `${time} - Disponible`;
            option.classList.add('time-slot-available');
        }
        timeSelect.appendChild(option);
    });
}

function setupEventListeners() {
    document.getElementById('appointmentForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('confirmationModal').querySelector('.close').addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        if (event.target === document.getElementById('confirmationModal')) {
            closeModal();
        }
    });
}

function handleFormSubmit(event) {
    event.preventDefault();
    if (!currentUser) {
        showError('loginError', 'Debes iniciar sesión para reservar un turno.');
        return;
    }

    const formData = new FormData(event.target);
    const appointmentData = {
        name: currentUser.name,
        date: formData.get('appointmentDate'),
        time: formData.get('timeSlot'),
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        userId: currentUser.uid,
        userEmail: currentUser.email
    };

    const newAppointmentRef = database.ref('appointments').push();
    newAppointmentRef.set(appointmentData)
        .then(() => {
            showConfirmation({ ...appointmentData, id: newAppointmentRef.key });
            event.target.reset();
        })
        .catch(error => {
            console.error("Error al reservar el turno: ", error);
            showRealTimeNotification('Error al reservar el turno.', 'error');
        });
}

function showConfirmation(appointment) {
    const modal = document.getElementById('confirmationModal');
    const detailsDiv = document.getElementById('confirmationDetails');
    const formattedDate = new Date(appointment.date + 'T00:00:00').toLocaleDateString('es-ES', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    detailsDiv.innerHTML = `
        <p><strong>Nombre:</strong> ${appointment.name}</p>
        <p><strong>Fecha:</strong> ${formattedDate}</p>
        <p><strong>Horario:</strong> ${appointment.time}</p>
        <p><strong>Número de turno:</strong> #${appointment.id}</p>
    `;
    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('confirmationModal').style.display = 'none';
}

function displayAppointments() {
    const container = document.getElementById('appointmentsContainer');
    const today = new Date().toISOString().split('T')[0];

    const upcomingAppointments = appointments
        .filter(apt => apt.date >= today)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    if (upcomingAppointments.length === 0) {
        container.innerHTML = '<p class="no-appointments">No hay turnos reservados</p>';
        return;
    }

    container.innerHTML = upcomingAppointments.map(appointment => `
        <div class="appointment-card ${appointment.date === today ? 'today' : ''}">
            <div class="appointment-time">${appointment.time}</div>
            <div class="appointment-name">${appointment.name}</div>
            <div class="appointment-date">
                ${new Date(appointment.date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', month: 'short', day: 'numeric' })}
                ${appointment.userId === currentUser.uid ? `<button class="btn-delete" onclick="deleteAppointment('${appointment.id}')">Cancelar</button>` : ''}
            </div>
        </div>
    `).join('');
}

function deleteAppointment(appointmentId) {
    if (confirm('¿Estás seguro de que quieres cancelar este turno?')) {
        database.ref('appointments/' + appointmentId).remove()
            .then(() => {
                showRealTimeNotification('Turno cancelado correctamente.', 'success');
            })
            .catch(error => {
                console.error("Error al cancelar el turno: ", error);
                showRealTimeNotification('Error al cancelar el turno.', 'error');
            });
    }
}

function displayTimeSlotsGrid() {
    const gridContainer = document.getElementById('timeSlotsGrid');
    const selectedDate = document.getElementById('gridDate').value;

    if (!selectedDate) return;

    const occupiedSlots = appointments.filter(apt => apt.date === selectedDate).map(apt => apt.time);

    gridContainer.innerHTML = TIME_SLOTS.map(time => {
        const isOccupied = occupiedSlots.includes(time);
        const occupiedAppointment = appointments.find(apt => apt.date === selectedDate && apt.time === time);
        return `
            <div class="time-slot ${isOccupied ? 'occupied' : 'available'}" title="${isOccupied ? `Ocupado por: ${occupiedAppointment.name}` : 'Horario disponible'}">
                <div class="slot-time">${time}</div>
                ${isOccupied ? `<div class="slot-name">${occupiedAppointment.name}</div>` : ''}
            </div>
        `;
    }).join('');
}

// 2. Real-Time Database Sync
function initializeRealTimeSync() {
    const appointmentsRef = database.ref('appointments');
    appointmentsRef.on('value', (snapshot) => {
        const data = snapshot.val() || {};
        appointments = Object.keys(data).map(key => ({
            id: key,
            ...data[key]
        }));
        // Update UI
        displayAppointments();
        displayTimeSlotsGrid();
        loadTimeSlots();
        updateStatistics(); // Make sure this function exists and is adapted
    });

    const statsRef = database.ref('dailyStats');
    statsRef.on('value', (snapshot) => {
        dailyStats = snapshot.val() || {};
        updateStatistics();
    });
}

function showRealTimeNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `real-time-notification ${type} show`;
    notification.innerHTML = `<div class="notification-content">${message}</div>`;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

// 3. Auth Functions
function initializeAuthSystem() {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('logoutBtn').addEventListener('click', logout);

    document.addEventListener('click', (event) => {
        const modals = document.querySelectorAll('.auth-modal');
        modals.forEach(modal => {
            if (event.target === modal) closeAuthModals();
        });
    });
}

function handleRegister(event) {
    event.preventDefault();
    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;

    if (password !== document.getElementById('confirmPassword').value) {
        showError('registerError', 'Las contraseñas no coinciden');
        return;
    }

    auth.createUserWithEmailAndPassword(email, password)
        .then(userCredential => {
            const user = userCredential.user;
            // Store user's name in Realtime Database
            return database.ref('users/' + user.uid).set({
                name: name,
                email: email,
                registeredAt: firebase.database.ServerValue.TIMESTAMP
            });
        })
        .then(() => {
            showSuccess('registerSuccess', '¡Registro exitoso! Ahora puedes iniciar sesión.');
            setTimeout(() => switchToLogin(), 2000);
        })
        .catch(error => {
            showError('registerError', error.message);
        });
}

function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    auth.signInWithEmailAndPassword(email, password)
        .then(() => {
            closeAuthModals();
        })
        .catch(error => {
            showError('loginError', 'Email o contraseña incorrectos.');
        });
}

function logout() {
    auth.signOut();
}

function showError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    errorElement.textContent = message;
    errorElement.style.display = 'block';
}

function hideError(elementId) {
    document.getElementById(elementId).style.display = 'none';
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
    document.getElementById('userName').value = currentUser.name;
    document.getElementById('userName').readOnly = true;
}

function showUnauthenticatedView() {
    document.getElementById('userInfo').style.display = 'none';
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('bookingForm').style.display = 'none';
    document.getElementById('appointmentsList').style.display = 'none';
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

// Dummy functions to avoid errors, should be replaced or implemented
function updateStatistics() {
    // This function needs to be fully implemented based on the new data structure
    console.log("Updating statistics...");
}

// All other functions like AI assistant, support modal, etc. remain the same for now
// ... (rest of the functions from the original script)
