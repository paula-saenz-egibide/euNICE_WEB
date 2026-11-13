import time
import json
from datetime import datetime

import board
import adafruit_dht
import paho.mqtt.client as mqtt
import RPi.GPIO as GPIO
from gpiozero import RGBLED, Button
from RPLCD.gpio import CharLCD

PIN_RELE_VENTILADOR = 21
PIN_SENSOR_DHT = board.D20
PIN_BOTON = 17
PIN_LED_ROJO = 22
PIN_LED_VERDE = 27
PIN_LED_AZUL = 18
PIN_SENSOR_LUZ = 5

TEMP_MINIMA = 25
TEMP_MAXIMA = 28

BROKER = "broker.emqx.io"
PUERTO = 1883

TOPIC_TEMPERATURA = "euNICE/data/temperatura"
TOPIC_HUMEDAD = "euNICE/data/humedad"
TOPIC_LUZ = "euNICE/data/luz"
TOPIC_LED = "euNICE/data/led"
TOPIC_VENTILADOR = "euNICE/data/ventilador"
TOPIC_RECEPCION_COMANDOS = "euNICE/comando/sistema"
TOPIC_CONFIGURACION = "euNICE/comando/configuracion"

GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)
GPIO.setup(PIN_RELE_VENTILADOR, GPIO.OUT)
GPIO.output(PIN_RELE_VENTILADOR, GPIO.LOW)

led_rgb = RGBLED(
    red=PIN_LED_ROJO,
    green=PIN_LED_VERDE,
    blue=PIN_LED_AZUL,
    active_high=True
)
boton = Button(PIN_BOTON)
sensor_luz = Button(PIN_SENSOR_LUZ, pull_up=False)

lcd = CharLCD(
    pin_rs=25, pin_rw=None, pin_e=24,
    pins_data=[23, 12, 16, 19],
    numbering_mode=GPIO.BCM, cols=16, rows=2,
    dotsize=8, auto_linebreaks=True
)


def iniciar_sensor_dht():
    return adafruit_dht.DHT11(PIN_SENSOR_DHT, use_pulseio=False)


sensor_dht = iniciar_sensor_dht()

sistema_encendido = False
estado_ventilador = "apagado"
modo_sistema = "automatico"
accion_termica_actual = "apagado"

color_frio = (0, 0, 1)
color_calor = (1, 0, 0)
color_neutro = (0, 1, 0)


def feedback_denegado_valido(denegacion, sistema_activo, modo, accion_termica, ventilador_actual):
    acciones_validas = ("apagado", "calefaccion", "aire_acondicionado")
    return (
        isinstance(denegacion, dict)
        and sistema_activo
        and modo == "feedback"
        and denegacion.get("accion") in acciones_validas
        and denegacion.get("accion") == accion_termica
        and denegacion.get("mantener") in acciones_validas
        and denegacion.get("mantener") == ventilador_actual
    )


def encender_sistema():
    global sistema_encendido
    if not sistema_encendido:
        sistema_encendido = True
        lcd.clear()
        print("\n>>> Sistema ENCENDIDO (Recogiendo datos...)\n")
        cliente_mqtt.publish(TOPIC_LED, "sistema_encendido")
        lcd.write_string('Sistema ON\r\nLeyendo sensor..')


def apagar_sistema():
    global sistema_encendido, estado_ventilador
    if sistema_encendido:
        sistema_encendido = False
        lcd.clear()
        print("\n>>> Sistema APAGADO (Envío de datos detenido)\n")
        led_rgb.off()
        GPIO.output(PIN_RELE_VENTILADOR, GPIO.LOW)
        estado_ventilador = "apagado"
        cliente_mqtt.publish(TOPIC_LED, "sistema_apagado")
        cliente_mqtt.publish(TOPIC_VENTILADOR, "ventilador_apagado")


def alternar_sistema_por_boton():
    if sistema_encendido:
        apagar_sistema()
    else:
        encender_sistema()


boton.when_pressed = alternar_sistema_por_boton


def on_connect(client, userdata, flags, reason_code, properties):
    print(f"Conectado a MQTT. Suscrito a comandos web en: {TOPIC_RECEPCION_COMANDOS}")
    client.subscribe([
        (TOPIC_RECEPCION_COMANDOS, 0),
        (TOPIC_CONFIGURACION, 0)
    ])


def actualizar_colores(colores):
    global color_frio, color_calor, color_neutro

    def convertir_color(valor):
        if (
            not isinstance(valor, list)
            or len(valor) != 3
            or any(not isinstance(canal, int) or not 0 <= canal <= 255 for canal in valor)
        ):
            raise ValueError("Cada color debe ser una lista RGB de 3 valores entre 0 y 255")
        return tuple(canal / 255.0 for canal in valor)

    if "frio" in colores:
        color_frio = convertir_color(colores["frio"])
    if "calor" in colores:
        color_calor = convertir_color(colores["calor"])
    if "neutro" in colores:
        color_neutro = convertir_color(colores["neutro"])


def on_message(client, userdata, msg):
    global modo_sistema, estado_ventilador

    try:
        datos = json.loads(msg.payload.decode("utf-8"))

        if msg.topic == TOPIC_CONFIGURACION:
            nuevo_modo = datos.get("modo")
            if nuevo_modo in ("automatico", "feedback"):
                modo_sistema = nuevo_modo
            if "config_led" in datos:
                actualizar_colores(datos["config_led"])
            print(f"\n[WEB] -> Configuración persistente aplicada ({modo_sistema.upper()})")
            return

        if "acción" in datos:
            accion = datos["acción"].lower()
            if accion == "encender":
                encender_sistema()
            elif accion == "apagar":
                apagar_sistema()

        if "modo" in datos:
            nuevo_modo = datos["modo"].lower()
            if nuevo_modo in ("automatico", "feedback"):
                modo_sistema = nuevo_modo
                print(f"\n[WEB] -> Modo cambiado a: {modo_sistema.upper()}")

        if "feedback_denegado" in datos:
            denegacion = datos["feedback_denegado"]
            if feedback_denegado_valido(
                denegacion,
                sistema_encendido,
                modo_sistema,
                accion_termica_actual,
                estado_ventilador
            ):
                GPIO.output(
                    PIN_RELE_VENTILADOR,
                    GPIO.LOW if estado_ventilador == "apagado" else GPIO.HIGH
                )
                cliente_mqtt.publish(
                    TOPIC_VENTILADOR,
                    f"ventilador_{estado_ventilador}"
                )
                print(
                    f"\n[WEB] -> Feedback denegado: se mantiene "
                    f"{estado_ventilador.upper()}"
                )
            else:
                print("[WEB] -> Feedback denegado ignorado: el estado ya ha cambiado")

        if "ventilador_forzado" in datos:
            accion_forzada = datos["ventilador_forzado"].lower()
            if (accion_forzada == "apagado"
                and sistema_encendido
                and modo_sistema == "feedback"
                and accion_termica_actual == "apagado"
                and estado_ventilador != "apagado"
            ):
                print("\n[WEB] -> Feedback aceptado: apagar climatización")
                GPIO.output(PIN_RELE_VENTILADOR, GPIO.LOW)
                estado_ventilador = "apagado"
                cliente_mqtt.publish(TOPIC_VENTILADOR, "ventilador_apagado")
            elif (
                sistema_encendido
                and modo_sistema == "feedback"
                and accion_forzada in ("calefaccion", "aire_acondicionado")
                and accion_forzada == accion_termica_actual
            ):
                print(f"\n[WEB] -> Feedback aceptado: {accion_forzada.upper()}")
                estado_ventilador = accion_forzada
                GPIO.output(PIN_RELE_VENTILADOR, GPIO.HIGH)
                cliente_mqtt.publish(
                    TOPIC_VENTILADOR,
                    f"ventilador_{estado_ventilador}"
                )
            else:
                print("[WEB] -> Feedback ignorado: el sistema ya no requiere esa acción")

        if "config_led" in datos:
            actualizar_colores(datos["config_led"])
            print("\n[WEB] -> Colores LED personalizados actualizados")

    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as error:
        print(f"Error al procesar comando MQTT: {error}")


cliente_mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
cliente_mqtt.on_connect = on_connect
cliente_mqtt.on_message = on_message

try:
    cliente_mqtt.connect(BROKER, PUERTO, 60)
    cliente_mqtt.loop_start()
except Exception as error:
    print(f"Error MQTT: {error}")

lcd.clear()

try:
    while True:
        if sistema_encendido:
            try:
                temperatura_c = sensor_dht.temperature
                humedad = sensor_dht.humidity

                if temperatura_c is None or humedad is None:
                    time.sleep(2.0)
                    continue

                if sensor_luz.is_pressed:
                    accion_luz = "Apagar luces"
                    texto_luz_lcd = "LUZ"
                else:
                    accion_luz = "Encender luces"
                    texto_luz_lcd = "OSC"

                lcd.clear()
                lcd.write_string(f'T:{temperatura_c}C {texto_luz_lcd}\r\nH:{humedad}%')

                if temperatura_c < TEMP_MINIMA:
                    led_rgb.color = color_frio
                    color_led_texto = "frio_custom"
                    estado_deseado_termico = "calefaccion"
                elif temperatura_c > TEMP_MAXIMA:
                    led_rgb.color = color_calor
                    color_led_texto = "calor_custom"
                    estado_deseado_termico = "aire_acondicionado"
                else:
                    led_rgb.color = color_neutro
                    color_led_texto = "neutro_custom"
                    estado_deseado_termico = "apagado"

                accion_termica_actual = estado_deseado_termico
                if modo_sistema == "automatico":
                    if estado_deseado_termico != estado_ventilador:
                        if estado_deseado_termico == "apagado":
                            GPIO.output(PIN_RELE_VENTILADOR, GPIO.LOW)
                        else:
                            GPIO.output(PIN_RELE_VENTILADOR, GPIO.HIGH)
                        estado_ventilador = estado_deseado_termico

                print(
                    f"[{modo_sistema.upper()}] Temp: {temperatura_c}°C | "
                    f"Hum: {humedad}% | Vent: {estado_ventilador.upper()} | "
                    f"Acción Luz: {accion_luz}"
                )

                cliente_mqtt.publish(TOPIC_TEMPERATURA, temperatura_c)
                cliente_mqtt.publish(TOPIC_HUMEDAD, humedad)
                cliente_mqtt.publish(TOPIC_LUZ, accion_luz)
                cliente_mqtt.publish(TOPIC_LED, color_led_texto)
                cliente_mqtt.publish(
                    TOPIC_VENTILADOR,
                    f"ventilador_{estado_ventilador}"
                )

            except RuntimeError:
                time.sleep(2.0)
                continue
            except Exception as error:
                print(f"Error leyendo sensores: {error}")
                sensor_dht.exit()
                time.sleep(1.0)
                sensor_dht = iniciar_sensor_dht()
                continue

            time.sleep(2.0)
        else:
            ahora = datetime.now()
            lcd.cursor_pos = (0, 0)
            lcd.write_string(ahora.strftime("%d/%m/%Y").center(16))
            lcd.cursor_pos = (1, 0)
            lcd.write_string(ahora.strftime("%H:%M:%S").center(16))
            time.sleep(1.0)

except KeyboardInterrupt:
    print("\nCerrando programa...")
    led_rgb.off()
    GPIO.output(PIN_RELE_VENTILADOR, GPIO.LOW)
    sensor_dht.exit()
    cliente_mqtt.loop_stop()
    cliente_mqtt.disconnect()
    lcd.clear()
    lcd.write_string('Apagando...\r\nAdios')
    time.sleep(1)
    lcd.clear()
    GPIO.cleanup()
