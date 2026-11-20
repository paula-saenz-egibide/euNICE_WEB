function obtenerSolicitudFeedback({ modo, sistemaEncendido, temperatura, ventilador }) {
    if (modo !== 'feedback' || !sistemaEncendido || !Number.isFinite(temperatura)) return null;

    let accionNecesaria = '';
    if (temperatura < 25) {
        accionNecesaria = 'calefaccion';
    } else if (temperatura > 28) {
        accionNecesaria = 'aire_acondicionado';
    } else if (ventilador !== 'apagado') {
        accionNecesaria = 'apagado';
    }

    const accionActual = ventilador || 'apagado';
    if (!accionNecesaria || accionNecesaria === accionActual) return null;
    return {
        transicion: `${accionActual}->${accionNecesaria}`,
        accion: accionNecesaria
    };
}

module.exports = { obtenerSolicitudFeedback };
