const socket = io({ autoConnect: false });

let sistemaActivo = false;
let modoActual = 'automatico';
let accionPendiente = '';
let accionAnteriorPendiente = '';
let ultimaTransicionFeedback = '';
let pausarActualizaciones = false; // Detiene la actualización visual si el pop-up está abierto
let fechasHistorico = [];
let fechaSeleccionada = fechaLocal(new Date());
let historicoDatos = [];
const claveTema = 'eunice-tema';

// Referencias del DOM
const animInicio = document.getElementById('animacion-principal');
const animHero = document.getElementById('animacion-hero');
const estadoTextoInicio = document.getElementById('estado-texto-inicio');
const estadoTextoHero = document.getElementById('estado-texto-hero');
const btnPower = document.getElementById('btn-power');
const btnPowerHero = document.getElementById('btn-power-hero');
const interruptorLampara = document.getElementById('interruptor-lampara');
const btnEntrar = document.getElementById('btn-entrar');
const modalFeedback = document.getElementById('modal-feedback');
const btnAceptarFeedback = document.getElementById('btn-aceptar-feedback');

const ctx = document.getElementById('graficaTemp').getContext('2d');
const chartTemp = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Temperatura (°C)',
                borderColor: '#E07A5F',
                backgroundColor: 'rgba(224, 122, 95, 0.15)',
                data: [],
                fill: true,
                tension: 0.35
            },
            {
                label: 'Humedad (%)',
                borderColor: '#81B29A',
                backgroundColor: 'rgba(129, 178, 154, 0.1)',
                data: [],
                fill: true,
                tension: 0.35
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        scales: {
            y: { beginAtZero: false }
        }
    }
});

function fechaLocal(fecha) {
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function mostrarFecha(fecha) {
    const [year, month, day] = fecha.split('-');
    return `${day}/${month}/${year}`;
}

function escaparHtml(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, caracter => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[caracter]);
}

// 1. Escuchar datos en tiempo real desde el servidor
socket.on('datos_actualizados', (datos) => {
    const estabaEncendido = sistemaActivo;
    sistemaActivo = datos.sistema_encendido;
    actualizarUI(datos);

    evaluarNecesidadFeedback(datos, sistemaActivo && !estabaEncendido);
});

socket.on('historico_actualizado', ({ fecha, registros }) => {
    if (fecha !== fechaSeleccionada) return;
    const registrosAnteriores = historicoDatos;
    historicoDatos = registros;
    window.historicoDatos = registros;
    document.getElementById('marca-datos-simulados').hidden =
        !registros.length || !registros.every(registro => registro.simulado === true);
    if (!actualizarGraficaEnVivo(registrosAnteriores, registros)) {
        actualizarHistorico();
    } else {
        actualizarTablaHistorico();
    }
});

socket.on('dias_disponibles', (fechas) => {
    fechasHistorico = fechas;
    actualizarControlesDia();
});

socket.on('configuracion_actualizada', (configuracion) => {
    modoActual = configuracion.modo;
    document.getElementById('select-modo').value = configuracion.modo;
    document.getElementById('col-frio').value = configuracion.colores.frio;
    document.getElementById('col-neutro').value = configuracion.colores.neutro;
    document.getElementById('col-calor').value = configuracion.colores.calor;
    ultimaTransicionFeedback = '';
});

socket.on('error_persistencia', mensaje => alert(mensaje));
socket.on('error_comando', mensaje => {
    interruptorLampara.checked = sistemaActivo;
    alert(mensaje);
});
socket.on('connect_error', error => {
    console.error('No se pudo abrir la conexión en tiempo real:', error.message);
});

interruptorLampara.addEventListener('change', () => {
    cambiarEstadoSistema(interruptorLampara.checked);
});

function actualizarControlTema() {
    const temaOscuro = document.documentElement.dataset.theme === 'dark';
    const controlTema = document.getElementById('theme-switch-checkbox');
    controlTema.checked = temaOscuro;
    controlTema.setAttribute(
        'aria-label',
        temaOscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'
    );
    document.querySelector('meta[name="theme-color"]').content = temaOscuro ? '#151b19' : '#f3f5f0';
    chartTemp.options.color = temaOscuro ? '#a2b0a8' : '#77827c';
    if (chartTemp.options.scales?.y) {
        chartTemp.options.scales.y.grid = {
            color: temaOscuro ? 'rgba(162, 176, 168, 0.12)' : 'rgba(119, 130, 124, 0.12)'
        };
        chartTemp.options.scales.y.ticks = { color: temaOscuro ? '#a2b0a8' : '#77827c' };
    }
    chartTemp.update();
}

function alternarTema() {
    const temaNuevo = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = temaNuevo;
    localStorage.setItem(claveTema, temaNuevo);
    actualizarControlTema();
}

actualizarControlTema();

function evaluarNecesidadFeedback(datos, omitirSolicitud = false) {
    if (pausarActualizaciones) return;

    let accionNecesaria = '';
    if (modoActual === 'feedback' && datos.sistema_encendido) {
        if (datos.temperatura < 25) {
            accionNecesaria = 'calefaccion';
        } else if (datos.temperatura > 28) {
            accionNecesaria = 'aire_acondicionado';
        } else {
            accionNecesaria = 'apagado';
        }
    }

    const accionActual = datos.ventilador || 'apagado';
    const necesitaCambio = accionNecesaria && accionNecesaria !== accionActual;
    const transicion = necesitaCambio ? `${accionActual}->${accionNecesaria}` : '';

    if (transicion !== ultimaTransicionFeedback) {
        ultimaTransicionFeedback = transicion;
        if (necesitaCambio && !omitirSolicitud) {
            solicitarFeedback(accionNecesaria, datos.temperatura, accionActual);
        }
    }
}

function actualizarHistorico() {
    const tipo = document.getElementById('tipo-grafico').value;
    const nombreGrafica = {
        line: 'Líneas',
        bar: 'Barras',
        doughnut: 'Circular'
    }[tipo];
    const botonExportar = document.getElementById('btn-exportar-excel');
    botonExportar.innerText = `Exportar Excel · ${nombreGrafica}`;
    botonExportar.disabled = historicoDatos.length === 0;
    if (tipo === 'doughnut') {
        const rangos = [
            historicoDatos.filter(dato => dato.temperatura < 25).length,
            historicoDatos.filter(dato => dato.temperatura >= 25 && dato.temperatura <= 28).length,
            historicoDatos.filter(dato => dato.temperatura > 28).length
        ];
        chartTemp.config.type = 'doughnut';
        chartTemp.data.labels = ['Frío (<25 °C)', 'Ideal (25-28 °C)', 'Calor (>28 °C)'];
        chartTemp.data.datasets = [{
            label: 'Lecturas',
            data: rangos,
            backgroundColor: ['#4A90E2', '#52B788', '#E07A5F']
        }];
        chartTemp.options.scales = {};
    } else {
        chartTemp.config.type = tipo;
        chartTemp.data.labels = historicoDatos.map(dato => dato.hora);
        chartTemp.data.datasets = [
            {
                label: 'Temperatura (°C)',
                borderColor: '#E07A5F',
                backgroundColor: tipo === 'bar' ? '#E07A5F' : 'rgba(224, 122, 95, 0.15)',
                data: historicoDatos.map(dato => dato.temperatura),
                fill: tipo === 'line',
                tension: 0.35
            },
            {
                label: 'Humedad (%)',
                borderColor: '#81B29A',
                backgroundColor: tipo === 'bar' ? '#81B29A' : 'rgba(129, 178, 154, 0.1)',
                data: historicoDatos.map(dato => dato.humedad),
                fill: tipo === 'line',
                tension: 0.35
            }
        ];
        chartTemp.options.scales = { y: { beginAtZero: false } };
    }
    chartTemp.update();

    actualizarTablaHistorico();
}

function actualizarGraficaEnVivo(registrosAnteriores, registros) {
    const hoy = fechaLocal(new Date());
    const esNuevaLectura = registros.length === registrosAnteriores.length + 1
        && registrosAnteriores.every((registro, indice) =>
            registro.timestamp === registros[indice]?.timestamp
        );
    if (
        fechaSeleccionada !== hoy
        || document.getElementById('tipo-grafico').value !== 'line'
        || chartTemp.config.type !== 'line'
        || !esNuevaLectura
        || chartTemp.data.labels.length !== registrosAnteriores.length
    ) {
        return false;
    }

    const ultimoRegistro = registros[registros.length - 1];
    chartTemp.data.labels.push(ultimoRegistro.hora);
    chartTemp.data.datasets[0].data.push(ultimoRegistro.temperatura);
    chartTemp.data.datasets[1].data.push(ultimoRegistro.humedad);
    chartTemp.update('none');
    return true;
}

function actualizarTablaHistorico() {
    const tbody = document.getElementById('tabla-historico-body');
    if (historicoDatos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No hay lecturas guardadas para este día.</td></tr>';
        return;
    }

    tbody.innerHTML = [...historicoDatos].reverse().map(item => `
        <tr>
            <td>${escaparHtml(item.hora)}</td>
            <td><strong>${escaparHtml(item.temperatura)} °C</strong></td>
            <td>${escaparHtml(item.humedad)} %</td>
            <td>${escaparHtml(item.luz || '--')}</td>
            <td>${escaparHtml((item.ventilador || 'apagado').toUpperCase())}</td>
        </tr>
    `).join('');
}

function actualizarControlesDia() {
    const hoy = fechaLocal(new Date());
    document.getElementById('fecha-estadisticas').innerText =
        fechaSeleccionada === hoy ? `Hoy · ${mostrarFecha(hoy)}` : mostrarFecha(fechaSeleccionada);
    document.getElementById('dia-anterior').disabled =
        !fechasHistorico.some(fecha => fecha < fechaSeleccionada);
    document.getElementById('dia-siguiente').disabled = fechaSeleccionada === hoy;
}

function cambiarDia(direccion) {
    const hoy = fechaLocal(new Date());
    const disponibles = fechasHistorico.filter(fecha => fecha <= hoy);
    if (direccion < 0) {
        const anteriores = disponibles.filter(fecha => fecha < fechaSeleccionada);
        if (anteriores.length) fechaSeleccionada = anteriores[anteriores.length - 1];
    } else {
        const siguientes = disponibles.filter(fecha => fecha > fechaSeleccionada);
        fechaSeleccionada = siguientes.length ? siguientes[0] : hoy;
    }
    actualizarControlesDia();
    socket.emit('solicitar_historico_dia', fechaSeleccionada);
}

function cambiarTipoGrafico() {
    actualizarHistorico();
}

// 3. Actualizar la interfaz visual
function actualizarUI(datos) {
    interruptorLampara.checked = datos.sistema_encendido;
    if (datos.sistema_encendido) {
        animInicio.className = 'animacion-cozy animacion-principal encendido';
        animHero.className = 'animacion-cozy pequeña encendido';

        estadoTextoInicio.innerText = 'Sistema encendido';
        estadoTextoHero.innerText = 'Estado: Encendido (ON)';

        btnPower.innerText = 'Apagar Dispositivo';
        btnPower.classList.add('btn-peligro');
        btnPowerHero.innerText = 'Apagar';
        btnPowerHero.classList.add('btn-peligro');

        btnEntrar.style.display = 'inline-block';
    } else {
        animInicio.className = 'animacion-cozy animacion-principal apagado';
        animHero.className = 'animacion-cozy pequeña apagado';

        estadoTextoInicio.innerText = 'Sistema apagado';
        estadoTextoHero.innerText = 'Estado: Apagado (OFF)';

        btnPower.innerText = 'Encender Dispositivo';
        btnPower.classList.remove('btn-peligro');
        btnPowerHero.innerText = 'Encender';
        btnPowerHero.classList.remove('btn-peligro');

        btnEntrar.style.display = 'none';
    }

    // Si no estamos esperando respuesta de un pop-up, actualizamos los números
    if (!pausarActualizaciones) {
        document.getElementById('val-temp').innerText = datos.temperatura;
        document.getElementById('val-hum').innerText = datos.humedad;
        document.getElementById('val-luz').innerText = datos.luz;
        document.getElementById('val-vent').innerText = datos.ventilador.replace('_', ' ').toUpperCase();
    }
}

// 4. Encender y Apagar por MQTT
function cambiarEstadoSistema(encender) {
    if (encender === sistemaActivo) return;
    const accion = encender ? "encender" : "apagar";
    socket.emit('enviar_comando', { "acción": accion });
}

function togglePower() {
    cambiarEstadoSistema(!sistemaActivo);
}

// 5. Cambiar modo (Automático / Feedback)
function cambiarModo() {
    modoActual = document.getElementById('select-modo').value;
    ultimaTransicionFeedback = '';
    socket.emit('enviar_comando', { "modo": modoActual });
}

function solicitarFeedback(accion, tempActual, accionActual) {
    pausarActualizaciones = true; // Pausa la recogida visual hasta que el usuario conteste
    accionPendiente = accion;
    accionAnteriorPendiente = accionActual;

    let texto;
    if (accion === 'apagado') {
        texto = `La temperatura está en ${tempActual}°C. ¿Deseas apagar la climatización?`;
        btnAceptarFeedback.innerText = 'Sí, apagar';
    } else {
        const nombreAccion = accion === 'calefaccion' ? 'la calefacción' : 'el aire acondicionado';
        const verbo = accionActual === 'apagado' ? 'encender' : 'cambiar a';
        texto = `La temperatura está en ${tempActual}°C. ¿Deseas ${verbo} ${nombreAccion}?`;
        btnAceptarFeedback.innerText = 'Sí, aceptar';
    }
    document.getElementById('texto-feedback').innerText = texto;
    modalFeedback.classList.add('activa');
}

function responderFeedback(autorizado) {
    modalFeedback.classList.remove('activa');
    pausarActualizaciones = false;

    if (autorizado && accionPendiente) {
        socket.emit('enviar_comando', { "ventilador_forzado": accionPendiente });
    } else if (accionPendiente) {
        socket.emit('enviar_comando', {
            feedback_denegado: {
                accion: accionPendiente,
                mantener: accionAnteriorPendiente
            }
        });
    }
    accionPendiente = '';
    accionAnteriorPendiente = '';
}

// 7. Configuración de Colores LED (Conversión HEX -> RGB 0-255 para tu Python)
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
}

function guardarColores() {
    const frio = hexToRgb(document.getElementById('col-frio').value);
    const neutro = hexToRgb(document.getElementById('col-neutro').value);
    const calor = hexToRgb(document.getElementById('col-calor').value);

    socket.emit('enviar_comando', {
        "config_led": {
            "frio": frio,
            "neutro": neutro,
            "calor": calor
        }
    });
}

function resetColores() {
    document.getElementById('col-frio').value = "#0000ff";
    document.getElementById('col-neutro').value = "#00ff00";
    document.getElementById('col-calor').value = "#ff0000";
    guardarColores();
}

// 8. Navegación entre pantallas y pestañas
function navegar(idPantalla) {
    document.querySelectorAll('.pantalla').forEach(p => p.classList.remove('activa'));
    document.getElementById(idPantalla).classList.add('activa');
}

function cambiarVista(idVista, btnPulsado) {
    document.querySelectorAll('.vista').forEach(v => v.classList.remove('activa'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('activo'));

    document.getElementById(idVista).classList.add('activa');
    btnPulsado.classList.add('activo');
}

async function exportarExcel() {
    if (historicoDatos.length === 0) {
        alert('No hay datos para exportar en el día seleccionado.');
        return;
    }

    try {
        const tipo = document.getElementById('tipo-grafico').value;
        const nombreTipo = { line: 'lineas', bar: 'barras', doughnut: 'circular' }[tipo];
        const esDemostracion = historicoDatos.every(registro => registro.simulado === true);
        const response = await fetch(
            `/api/exportar-excel?fecha=${encodeURIComponent(fechaSeleccionada)}&tipo=${encodeURIComponent(tipo)}`
        );
        if (!response.ok) throw new Error(await response.text());
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `euNICE_${fechaSeleccionada}_${nombreTipo}${esDemostracion ? '_demostracion' : ''}.xlsx`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (error) {
        console.error('Error al descargar el Excel:', error);
        alert(`No se pudo descargar el Excel: ${error.message}`);
    }
}

const loginForm = document.getElementById('login-form');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginMessage = document.getElementById('login-message');
const pushStatus = document.getElementById('push-status');
const pushToggle = document.getElementById('push-toggle');
let registroServiceWorker = null;
let suscripcionPush = null;

function mostrarAplicacion() {
    document.body.classList.add('autenticado');
    socket.connect();
    prepararNotificaciones();
    if (new URLSearchParams(window.location.search).has('notificacion')) {
        navegar('pantalla-app');
    }
}

function esIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function estaInstaladaComoPWA() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

async function prepararNotificaciones() {
    if (esIOS() && !estaInstaladaComoPWA()) {
        pushStatus.innerText = 'En iPhone, añade euNICE a la pantalla de inicio antes de activar avisos.';
        pushToggle.disabled = true;
        return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        pushStatus.innerText = 'Este navegador no admite notificaciones web push.';
        pushToggle.disabled = true;
        return;
    }

    try {
        registroServiceWorker = await navigator.serviceWorker.register('/service-worker.js');
        suscripcionPush = await registroServiceWorker.pushManager.getSubscription();
        if (!suscripcionPush) {
            const statusResponse = await fetch('/api/push/status');
            const statusResult = await statusResponse.json();
            if (!statusResponse.ok || !statusResult.configured) {
                pushStatus.innerText = 'El servidor todavía no está configurado para enviar notificaciones push.';
                pushToggle.disabled = true;
                return;
            }
        }
        pushToggle.disabled = false;
        pushToggle.innerText = suscripcionPush ? 'Desactivar notificaciones' : 'Activar notificaciones';
        pushStatus.innerText = suscripcionPush
            ? 'Avisos activos para solicitudes de confirmación y cambios de estado.'
            : 'Activa los avisos para solicitudes de confirmación y cambios de estado.';
    } catch (error) {
        console.error('No se pudo preparar el service worker:', error);
        pushStatus.innerText = `No se pudieron preparar las notificaciones: ${error.message}`;
        pushToggle.disabled = true;
    }
}

function convertirClavePublica(clave) {
    const base64 = clave.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = window.atob(base64);
    return Uint8Array.from(bytes, caracter => caracter.charCodeAt(0));
}

async function alternarNotificaciones() {
    pushToggle.disabled = true;
    try {
        if (!registroServiceWorker) {
            throw new Error('El service worker todavía no está preparado.');
        }

        if (suscripcionPush) {
            const response = await fetch('/api/push-subscriptions', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: suscripcionPush.endpoint })
            });
            if (!response.ok) throw new Error((await response.json()).error || 'No se pudo desactivar el aviso.');
            await suscripcionPush.unsubscribe();
            suscripcionPush = null;
        } else {
            const permissionPromise = Notification.permission === 'default'
                ? Notification.requestPermission()
                : Promise.resolve(Notification.permission);
            const keyResponsePromise = fetch('/api/push/public-key');
            const [permission, keyResponse] = await Promise.all([permissionPromise, keyResponsePromise]);
            const keyResult = await keyResponse.json();
            if (!keyResponse.ok) throw new Error(keyResult.error || 'No se pudo cargar la clave push.');
            if (permission !== 'granted') throw new Error('No se concedió permiso para las notificaciones.');

            suscripcionPush = await registroServiceWorker.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertirClavePublica(keyResult.publicKey)
            });
            const response = await fetch('/api/push-subscriptions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(suscripcionPush)
            });
            if (!response.ok) {
                await suscripcionPush.unsubscribe();
                suscripcionPush = null;
                throw new Error((await response.json()).error || 'No se pudo guardar la suscripción.');
            }
        }
        await prepararNotificaciones();
    } catch (error) {
        console.error('No se pudo cambiar la suscripción push:', error);
        pushStatus.innerText = error.message;
    } finally {
        pushToggle.disabled = false;
    }
}

loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    loginMessage.innerText = '';
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: loginUsername.value,
                password: loginPassword.value
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo iniciar sesión.');
        loginPassword.value = '';
        mostrarAplicacion();
    } catch (error) {
        loginMessage.innerText = error.message;
    }
});

pushToggle.addEventListener('click', alternarNotificaciones);

document.getElementById('logout-button').addEventListener('click', async () => {
    try {
        const response = await fetch('/api/logout', { method: 'POST' });
        if (!response.ok) throw new Error('No se pudo cerrar la sesión.');
        window.location.reload();
    } catch (error) {
        alert(error.message);
    }
});

fetch('/api/session')
    .then(response => {
        if (!response.ok) throw new Error('No se pudo comprobar la sesión.');
        return response.json();
    })
    .then(result => {
        if (result.authenticated) {
            mostrarAplicacion();
        } else {
            loginUsername.focus();
        }
    })
    .catch(error => {
        console.error('No se pudo comprobar la sesión:', error);
        loginMessage.innerText = error.message;
    });