# -*- coding: utf-8 -*-
"""
ACTUALIZACIÓN CATÁLOGO 2026-2028 - FSI SAC / EL IQUEÑO
Actualiza description / specifications / features / dimensions de los 24
productos (IDs 5-28) con los datos exactos del catálogo impreso.
NO toca price, image_url ni pdf_url. Idempotente: se puede re-ejecutar.
"""
import os
import json
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
load_dotenv(BACKEND_DIR / ".env")

PRODUCTS = [
    # ------------------------------------------------------------------ 01
    {
        "name": "COSECHADORA DE PAPA Y/O CAMOTE CON CAJA IMPORTADA",
        "description": "Cosechadora con enganche de tres puntos, diseñada para todo tipo de terreno agrícola. Cardan T4 para cosechadora y cadenas reforzadas que permiten realizar una labor perfecta y segura.",
        "specs": [
            {"label": "Modelo", "value": "CPFSI 65 / CPFSI 70 / CPFSI 75 / CPFSI 79"},
            {"label": "CPFSI 65", "value": "Cuerpo delantero 65 cm · Cuerpo posterior 70 cm · Eslabones cd. delantera 62 · Eslabones cd. posterior 40 · Peso 380 kg · 40 a 65 HP · Cosecha: CAMOTE"},
            {"label": "CPFSI 70", "value": "Cuerpo delantero 70 cm · Cuerpo posterior 75 cm · Eslabones cd. delantera 62 · Eslabones cd. posterior 40 · Peso 420 kg · 50 a 65 HP · Cosecha: CAMOTE"},
            {"label": "CPFSI 75", "value": "Cuerpo delantero 75 cm · Cuerpo posterior 79 cm · Eslabones cd. delantera 62 · Eslabones cd. posterior 40 · Peso 450 kg · 50 a 65 HP · Cosecha: PAPA"},
            {"label": "CPFSI 79", "value": "Cuerpo delantero 79 cm · Cuerpo posterior 79 cm · Eslabones cd. delantera 62 · Eslabones cd. posterior 40 · Peso 480 kg · 50 a 70 HP · Cosecha: PAPA"},
            {"label": "Peso aprox.", "value": "480 kg"},
            {"label": "Potencia requerida", "value": "40 a 70 HP"},
            {"label": "Tipo de cosecha", "value": "CAMOTE / PAPA"},
            {"label": "Repuestos", "value": "Cadena transportadora · Cardan T4 para cosechadora · Batidores de cadena transportadora · Trompo guía con rodaje · Piñón Z=12 · Chumacera de pie · Rodillo guía · Piñón Z=14 · Trompo normal · Piñón lateral Z=15 · Piñón lateral Z=18"},
        ],
        "features": [
            "Cosechadora con enganche de tres puntos, diseñada para todo tipo de terreno agrícola.",
            "Cardan T4 para cosechadora.",
            "Cadenas reforzadas que permiten realizar una labor perfecta y segura.",
        ],
        "dims": {"width": 0, "height": 0, "depth": 0, "weight": 480},
    },
    # ------------------------------------------------------------------ 02
    {
        "name": "COSECHADORA DE PAPA CON DESCARGA LATERAL",
        "description": "Cosechadora de papa con descarga lateral, enganche de tres puntos para todo tipo de terreno agrícola, chasis metálico en plancha de acero estructural y cardan telescópico con protección (T4) marca AEMCO.",
        "specs": [
            {"label": "Dimensiones", "value": "2.40 m largo x 1.50 m ancho x 1.20 m alto"},
            {"label": "Eslabones cadena delantera", "value": "60 unidades"},
            {"label": "Eslabones cadena posterior", "value": "50 unidades"},
            {"label": "Peso aprox.", "value": "480 kg"},
            {"label": "Potencia requerida", "value": "70 HP"},
        ],
        "features": [
            "Enganche de tres puntos diseñada para todo tipo de terreno agrícola.",
            "Chasis metálico en plancha de acero estructural.",
            "Transmisión con 2 cajas de engranaje mediante corona y piñón, con sistema de embrague.",
            "Accesorios: trompos, batidores, rodillos y piñones.",
            "Cardan telescópico con protección (T4) marca AEMCO.",
        ],
        "dims": {"width": 150, "height": 120, "depth": 240, "weight": 480},
    },
    # ------------------------------------------------------------------ 03
    {
        "name": "COSECHADORA DE PAPA CON COLA LARGA",
        "description": "Cosechadora de papa con cola larga, enganche de tres puntos para todo tipo de terreno agrícola, ejes de transmisión en acero SAE 1045, chasis metálico en plancha de acero estructural y cardan telescópico (T4) marca AEMCO.",
        "specs": [
            {"label": "Dimensiones", "value": "2.80 m largo x 1.50 m ancho x 1.20 m alto"},
            {"label": "Eslabones cadena delantera", "value": "60 unidades"},
            {"label": "Eslabones cadena posterior", "value": "55 unidades"},
            {"label": "Peso aprox.", "value": "480 kg"},
            {"label": "Potencia requerida", "value": "70 HP"},
        ],
        "features": [
            "Enganche de tres puntos diseñada para todo tipo de terreno agrícola.",
            "Ejes de transmisión en acero SAE 1045.",
            "Chasis metálico en plancha de acero estructural.",
            "Accesorios: trompos, batidores, rodillos y piñones.",
            "Cardan telescópico con protección (T4) marca AEMCO.",
        ],
        "dims": {"width": 150, "height": 120, "depth": 280, "weight": 480},
    },
    # ------------------------------------------------------------------ 04
    {
        "name": "CULTIVADORA DE BRAZOS RÍGIDOS CON VERTEDERAS REGULABLES",
        "description": "Cultivadora de brazos rígidos con vertederas regulables, barra cuadrada acerada, equipo totalmente desmontable, de fácil regulación, distanciamiento y altura de los brazos.",
        "specs": [
            {"label": "Modelo", "value": "CULFSI 1 / CULFSI 2"},
            {"label": "CULFSI 1", "value": "3 brazos rectos · 6 brazos curvos · Barra 2 ½\" x 2 ½\" x 3 mt · Prof. 25 cm · 400 kg · 50 a 65 HP"},
            {"label": "CULFSI 2", "value": "6 brazos rectos · 3 brazos curvos · Barra 2 ½\" x 2 ½\" x 3 mt · Prof. 25 cm · 400 kg · 50 a 65 HP"},
            {"label": "Dimensiones de la barra", "value": "2 ½\" x 2 ½\" x 3 mt"},
            {"label": "Profundidad de trabajo", "value": "25 cm"},
            {"label": "Peso aprox.", "value": "400 kg"},
            {"label": "Potencia requerida", "value": "50 a 65 HP"},
            {"label": "Repuestos", "value": "Brazo recto · Brazo curvo · Punta cincel · Punta V o flecha"},
        ],
        "features": [
            "Barra cuadrada acerada.",
            "Equipo totalmente desmontable.",
            "Carteras con pernos oscilantes.",
            "Fácil regulación, distanciamiento y altura de los brazos.",
            "Castillo de enganche de tres puntos.",
            "Uñas desmontables y reversibles.",
        ],
        "dims": {"width": 300, "height": 0, "depth": 0, "weight": 400},
    },
    # ------------------------------------------------------------------ 05
    {
        "name": "MINICULTIVADORA DE BRAZOS RIGIDOS",
        "description": "Minicultivadora de brazos rígidos, barra cuadrada, equipo totalmente desmontable con puntas V desmontables y reversibles. Diseñada para tractores de baja potencia.",
        "specs": [
            {"label": "Modelo", "value": "SURFSI 1 / SURFSI 2"},
            {"label": "SURFSI 1", "value": "2 brazos rectos · Barra 2\" x 2\" x 1 mt · Peso 80 kg"},
            {"label": "SURFSI 2", "value": "4 brazos rectos · Barra 2\" x 2\" x 1 mt · Peso 100 kg"},
            {"label": "Dimensiones", "value": "70 cm alto x 50 cm ancho x 1 mt largo"},
            {"label": "Dimensiones de la barra", "value": "2\" x 2\" x 1 mt"},
            {"label": "Profundidad de trabajo", "value": "10 a 15 cm"},
            {"label": "Peso aprox.", "value": "100 a 200 kg"},
            {"label": "Potencia requerida", "value": "16 a 20 HP"},
            {"label": "Repuestos", "value": "Cajón · Punta cincel · Punta V o flechas"},
        ],
        "features": [
            "Barra cuadrada.",
            "Equipo totalmente desmontable.",
            "Carteras con pernos oscilantes.",
            "Fácil regulación, distanciamiento y altura de los brazos.",
            "Castillo de enganche de tres puntos.",
            "Puntas V desmontables y reversibles.",
        ],
        "dims": {"width": 50, "height": 70, "depth": 100, "weight": 120},
    },
    # ------------------------------------------------------------------ 06
    {
        "name": "SURCADORA DE BRAZOS RIGIDOS",
        "description": "Surcadora de brazos rígidos, barra cuadrada acerada, equipo totalmente desmontable con cajones estándar, de fácil regulación, distanciamiento y altura de los brazos.",
        "specs": [
            {"label": "Modelo", "value": "SURBFSI 1 / SURBFSI 2"},
            {"label": "SURBFSI 1", "value": "2 brazos rectos · Barra 2.5\" x 2.5\" x 2.5 mt · Peso 275 kg"},
            {"label": "SURBFSI 2", "value": "3 brazos rectos · Barra 2.5\" x 2.5\" x 2.5 mt · Peso 300 kg"},
            {"label": "Dimensiones de la barra", "value": "2.5\" x 2.5\" x 2.5 mt"},
            {"label": "Profundidad de trabajo", "value": "70 cm"},
            {"label": "Peso aprox.", "value": "300 kg"},
            {"label": "Potencia requerida", "value": "50 a 65 HP"},
            {"label": "Repuestos", "value": "Brazo curvo · Cajón · Cajones"},
        ],
        "features": [
            "Barra cuadrada acerada.",
            "Equipo totalmente desmontable.",
            "Carteras con pernos oscilantes.",
            "Fácil regulación, distanciamiento y altura de los brazos.",
            "Castillo de enganche de tres puntos.",
            "Cajones estándar.",
        ],
        "dims": {"width": 250, "height": 0, "depth": 0, "weight": 300},
    },
    # ------------------------------------------------------------------ 07
    {
        "name": "SUBSOLADOR",
        "description": "Subsolador de chasis tubular en perfil rectangular, brazos curvos en acero antiabrasivo, puntas desmontables intercambiables y fácil regulación.",
        "specs": [
            {"label": "Modelo", "value": "SUBFSI 1 / SUBFSI 2 / SUBFSI 3"},
            {"label": "SUBFSI 1", "value": "1 brazo · Prof. 70 cm · Peso 150 kg · 50 a 60 HP"},
            {"label": "SUBFSI 2", "value": "2 brazos · Distancia entre brazos 60 a 80 cm · Prof. 70 cm · Peso 330 kg · 80 a 90 HP"},
            {"label": "SUBFSI 3", "value": "3 brazos · Distancia entre brazos 60 a 80 cm · Prof. 70 cm · Peso 400 kg · 100 a 120 HP"},
            {"label": "Distancia entre brazos", "value": "60 a 80 cm"},
            {"label": "Profundidad de trabajo", "value": "70 cm"},
            {"label": "Peso aprox.", "value": "150 a 400 kg"},
            {"label": "Potencia requerida", "value": "50 a 120 HP"},
            {"label": "Repuestos", "value": "Cuchilla para subsolador · Pin de enganche · Brazo con cartera"},
        ],
        "features": [
            "Chasis tubular en perfil rectangular.",
            "Brazos curvos en acero antiabrasivo.",
            "Puntas desmontables intercambiables.",
            "Fácil regulación.",
        ],
        "dims": {"width": 0, "height": 0, "depth": 0, "weight": 400},
    },
    # ------------------------------------------------------------------ 08
    {
        "name": "PICADORA DE HOJA DE PAPA CON BOMBÍN HIDRÁULICO",
        "description": "Picadora de hoja de papa accionada por la toma de fuerza del tractor, ideal para limpieza del terreno antes de la cosecha de papa/camote. Chasis reforzado en acero estructural, asistida con sistema hidráulico.",
        "specs": [
            {"label": "Modelo", "value": "PPBFSI 1 / PPBFSI 2"},
            {"label": "PPBFSI 1", "value": "34 martillos · Ancho de trabajo 1.80 mt · Máquina 2.30 mt ancho x 2.50 mt largo x 1.10 mt alto · 650 kg · 80 a 90 HP"},
            {"label": "PPBFSI 2", "value": "38 martillos · Ancho de trabajo 2.00 mt · Máquina 2.50 mt ancho x 2.50 mt largo x 1.10 mt alto · 700 kg · 80 a 90 HP"},
            {"label": "Ancho de trabajo", "value": "1.80 a 2.00 mt"},
            {"label": "Medidas de la máquina", "value": "2.30/2.50 mt ancho x 2.50 mt largo x 1.10 mt alto"},
            {"label": "Peso aprox.", "value": "650 a 700 kg"},
            {"label": "Potencia requerida", "value": "80 a 90 HP"},
            {"label": "Repuestos", "value": "Martillos con corbata larga · Martillos con corbata corta"},
        ],
        "features": [
            "Accionada por la toma de fuerza del tractor, ideal para limpieza del terreno antes de la cosecha de papa/camote.",
            "Chasis reforzado en acero estructural.",
            "Sistema de arrastre de tiro.",
            "Asistido con sistema hidráulico.",
        ],
        "dims": {"width": 250, "height": 110, "depth": 250, "weight": 700},
    },
    # ------------------------------------------------------------------ 09
    {
        "name": "PICADORA DE HOJA DE PAPA CON ENGANCHE TRES PUNTOS",
        "description": "Picadora de hoja de papa accionada por la toma de fuerza del tractor, ideal para limpieza del terreno antes de la cosecha de papa. Chasis reforzado en acero estructural con enganche de 3 puntos.",
        "specs": [
            {"label": "Modelo", "value": "PPEFSI 1 / PPEFSI 2"},
            {"label": "PPEFSI 1", "value": "34 martillos · Ancho de trabajo 1.80 mt · Máquina 2.30 mt ancho x 2.30 mt largo x 1.10 mt alto · 650 kg · 80 a 90 HP"},
            {"label": "PPEFSI 2", "value": "38 martillos · Ancho de trabajo 2.00 mt · Máquina 2.50 mt ancho x 2.30 mt largo x 1.10 mt alto · 680 kg · 100 HP"},
            {"label": "Ancho de trabajo", "value": "1.80 a 2.00 mt"},
            {"label": "Medidas de la máquina", "value": "2.30/2.50 mt ancho x 2.30 mt largo x 1.10 mt alto"},
            {"label": "Peso aprox.", "value": "650 a 680 kg"},
            {"label": "Potencia requerida", "value": "80 a 100 HP"},
            {"label": "Repuestos", "value": "Martillos con corbata larga · Martillos con corbata corta"},
        ],
        "features": [
            "Accionada por la toma de fuerza del tractor, ideal para limpieza del terreno antes de la cosecha de papa.",
            "Chasis reforzado en acero estructural.",
            "Sistema de enganche 3 puntos.",
            "Cuenta con 34 martillos de acero anti abrasivo.",
            "2 poleas de accionamiento, fajas en \"V\".",
            "2 neumáticos, aro Nº 14.",
            "Cardan agrícola con funda protectora.",
        ],
        "dims": {"width": 250, "height": 110, "depth": 230, "weight": 680},
    },
    # ------------------------------------------------------------------ 10
    {
        "name": "PICADORA DE CHALA ESTACIONARIA",
        "description": "Picadora ideal para cortar caña, pasto, malezas y todo tipo de forrajes. Chasis en acero estructural, tolva de alimentación manual y salida por ducto cuello de cisne, accionada a motor eléctrico trifásico.",
        "specs": [
            {"label": "Modelo", "value": "PCHFSI 1 / PCHFSI 2"},
            {"label": "PCHFSI 1", "value": "8 cuchillas · Capacidad 2 a 4 TN/hora · Máquina 0.80 mt ancho x 2 mt largo x 1.80 mt alto · 180 kg · 10 HP"},
            {"label": "PCHFSI 2", "value": "3 cuchillas · Capacidad 3 a 5 TN/hora · Máquina 1.20 mt ancho x 2 mt largo x 1.80 mt alto · 650 kg · 20 HP"},
            {"label": "Capacidad de producción", "value": "2 a 5 TN / hora"},
            {"label": "Medidas de la máquina", "value": "0.80/1.20 mt ancho x 2 mt largo x 1.80 mt alto"},
            {"label": "Peso aprox.", "value": "180 a 650 kg"},
            {"label": "Potencia requerida (motor)", "value": "10 a 20 HP"},
            {"label": "Repuestos", "value": "Cuchillas anti abrasivas y rodillos jaladores"},
        ],
        "features": [
            "Picadora ideal para cortar caña, pasto, malezas y todo tipo de forrajes.",
            "Chasis en acero estructural.",
            "Tolva de alimentación manual y salida por ducto cuello de cisne.",
            "Poleas, fajas y chumacera de pie.",
            "Piñones de accionamiento y cadena de transmisión.",
            "Caja accionada a motor eléctrico trifásico.",
        ],
        "dims": {"width": 120, "height": 180, "depth": 200, "weight": 650},
    },
    # ------------------------------------------------------------------ 11
    {
        "name": "HOYADORA AGRICOLA",
        "description": "Hoyadora de enganche de tres puntos accionada con chasis en acero tubular rectangular, caja reductora con embrague y cardan con protección accionado con la toma de fuerza del tractor.",
        "specs": [
            {"label": "Modelo", "value": "HBFSI 1 / HBFSI 2 / HBFSI 3 / HBFSI 4"},
            {"label": "HBFSI 1", "value": "Broca Ø 12\" · Altura del hoyo Ø 6\" a Ø 8\" según necesidad · 180 kg · 70 HP"},
            {"label": "HBFSI 2", "value": "Broca según necesidad (Ø 6\" a Ø 8\") · 180 kg · 70 HP"},
            {"label": "HBFSI 3", "value": "Broca Ø 16\" · 200 kg · 70 HP"},
            {"label": "HBFSI 4", "value": "Broca Ø 21\" · 200 kg · 70 HP"},
            {"label": "Broca N°", "value": "Ø 12\" / Ø 16\" / Ø 21\" / según necesidad"},
            {"label": "Altura del hoyo", "value": "Ø 6\" a Ø 8\" según necesidad"},
            {"label": "Medidas de la máquina", "value": "1 mt ancho x 1.70 mt largo x 1.70 mt alto"},
            {"label": "Peso aprox.", "value": "180 a 200 kg"},
            {"label": "Potencia requerida (motor)", "value": "70 HP"},
        ],
        "features": [
            "Hoyadora de enganche de tres puntos accionada con chasis en acero tubular rectangular.",
            "Caja reductora.",
            "Embrague para caja reductora.",
            "Cardan con protección accionado con la toma de fuerza del tractor.",
            "Barreno de perforación reforzado.",
            "Juego de cuchillas aceradas.",
        ],
        "dims": {"width": 100, "height": 170, "depth": 170, "weight": 200},
    },
    # ------------------------------------------------------------------ 12
    {
        "name": "COSECHADORA DE CEBOLLA",
        "description": "Cosechadora de cebolla con chasis fabricado en acero estructural reforzado, de enganche tres puntos categoría II, con caja central de engranaje y piñones.",
        "specs": [
            {"label": "Ancho de trabajo", "value": "1.80 mt"},
            {"label": "Dimensiones", "value": "1.90 mt largo x 0.90 mt ancho x 1.30 mt alto"},
            {"label": "Peso aprox.", "value": "400 kg"},
            {"label": "Potencia requerida", "value": "50 a 65 HP"},
            {"label": "Repuestos", "value": "Rueda de corte · Barra cuadrada acerada"},
        ],
        "features": [
            "Chasis fabricado en acero estructural reforzado.",
            "De enganche tres puntos, categoría II.",
            "Caja central de engranaje y piñones.",
            "Barra cuadrada en acero 1045.",
            "Ruedas de corte con regulador de profundidad.",
            "Punta cincel en cada brazo.",
        ],
        "dims": {"width": 90, "height": 130, "depth": 190, "weight": 400},
    },
    # ------------------------------------------------------------------ 13
    {
        "name": "DESGRANADORA DE MAIZ DURO",
        "description": "Desgranadora de maíz duro en material de acero estructural, enganche tres puntos categoría II, cardan accionado por la toma de fuerza del tractor. Producción de 14 a 16 Tn/hr.",
        "specs": [
            {"label": "Producción", "value": "14 a 16 Tn/hr"},
            {"label": "Dimensiones", "value": "1.20 m ancho x 1.5 m alto x 2.0 m largo"},
            {"label": "Peso aprox.", "value": "350 kg"},
            {"label": "Potencia requerida", "value": "70 HP"},
            {"label": "Repuestos", "value": "Cajón"},
        ],
        "features": [
            "Material en acero estructural.",
            "Enganche tres puntos categoría II.",
            "Cardan accionada para toma de fuerza de tractor.",
            "Piñones y cadena para transmisión del sistema.",
            "Tambor interior de desgrane.",
            "Tolva para ingreso de mazorcas.",
            "Ductos de salida de granos y coronta.",
        ],
        "dims": {"width": 120, "height": 150, "depth": 200, "weight": 350},
    },
    # ------------------------------------------------------------------ 14
    {
        "name": "MOLINO O PULVERIZADOR DE CASCARA DE COCO",
        "description": "Trituradora y molino pulverizador de cáscara de coco seco, chasis en acero estructural, con tolva de ingreso de 50x50 cm, trituración y pulverización con 48 martillos acerados cada uno y ciclón de salida. Producción de 500 kg/h.",
        "specs": [
            {"label": "Producción requerida", "value": "500 kg/h"},
            {"label": "Tolva de ingreso", "value": "50 cm x 50 cm de coco seco"},
            {"label": "Zarandas de trituración", "value": "Agujeros de Ø 1\" y Ø 3/4\""},
            {"label": "Zaranda de pulverización", "value": "Agujeros de Ø 3 mm y 2 mm"},
            {"label": "Martillos de trituración", "value": "48 martillos acerados"},
            {"label": "Martillos de pulverización", "value": "48 martillos acerados"},
            {"label": "Motores trifásicos", "value": "10 HP (trituración) y 10 HP (pulverización)"},
            {"label": "Ventilador", "value": "De succión de polvillo (2 paletas)"},
            {"label": "Ciclón", "value": "Con caída para 2 salidas del polvillo de pulverización"},
            {"label": "Transmisión", "value": "4 poleas y fajas en \"V\""},
        ],
        "features": [
            "Trituradora y molienda de coco seco.",
            "Chasis en acero estructural.",
            "Tolva de ingreso de 50 cm x 50 cm de coco seco.",
            "Cajón de trituración.",
            "Ejes de trituración y pulverización.",
            "48 martillos acerados para trituración.",
            "Zarandas con agujeros de Ø 1\" y Ø 3/4\".",
            "Motor trifásico de 10 HP (trituración).",
            "Cajón de pulverización.",
            "48 martillos acerados para pulverización.",
            "Zaranda con agujeros de Ø 3 mm y 2 mm.",
            "Ventilador de succión de polvillo (2 paletas).",
            "Ciclón con caída para 2 salidas del polvillo de pulverización.",
            "4 poleas y fajas en \"V\".",
            "Chumaceras de pared.",
            "Tablero para control de encendido y apagado.",
            "Producción requerida de 500 kg/h.",
        ],
        "dims": {"width": 0, "height": 0, "depth": 0, "weight": 0},
    },
    # ------------------------------------------------------------------ 15
    {
        "name": "CARRETA AGRICOLA PARA COSECHA",
        "description": "Carreta agrícola basculante baja y/o alta para cosecha, chasis fabricado en acero estructural, plataforma en plancha estriada, soporte de llantas en sistema PIVOT basculante. Cambios de medida según necesidad.",
        "specs": [
            {"label": "Capacidad de carga", "value": "2 Tn"},
            {"label": "Altura del piso a plataforma", "value": "50 o 70 cm"},
            {"label": "Ancho de plataforma", "value": "2.00 m"},
            {"label": "Longitud de plataforma", "value": "3.60 m"},
            {"label": "Llantas", "value": "4 llantas radiales aro Nº 13"},
            {"label": "Cambios de medida", "value": "Según necesidad"},
        ],
        "features": [
            "Altura del piso a plataforma 50 o 70 cm.",
            "Chasis fabricado en acero estructural.",
            "Plataforma de carreta en plancha estriada.",
            "Soporte de llantas en sistema PIVOT basculante.",
            "Baranda delantera y laterales (volcables).",
            "Tiro de enganche delantero y posterior, para remolque.",
            "Parante de auto soporte.",
        ],
        "dims": {"width": 200, "height": 70, "depth": 360, "weight": 0},
    },
    # ------------------------------------------------------------------ 16
    {
        "name": "LAMPON AGRÍCOLA DE LEVANTE",
        "description": "Lampón agrícola de levante fabricado en plancha y perfiles de acero estructural, con cuchilla en acero antidesgaste y castillo de enganche de 3 puntos.",
        "specs": [
            {"label": "Ancho de trabajo", "value": "3.00 m"},
            {"label": "Profundidad", "value": "10 cm"},
            {"label": "Altura de trabajo", "value": "50 cm"},
            {"label": "Peso aprox.", "value": "450 kg"},
            {"label": "Potencia requerida", "value": "100 HP"},
        ],
        "features": [
            "Fabricado en plancha y perfiles de acero estructural.",
            "Cuchilla en acero antidesgaste.",
            "Castillo de enganche 3 puntos.",
        ],
        "dims": {"width": 300, "height": 50, "depth": 0, "weight": 450},
    },
    # ------------------------------------------------------------------ 17
    {
        "name": "ABONADORA HIDRÁULICA",
        "description": "Abonadora hidráulica totalmente desmontable, de fácil regulación, distanciamiento y altura de los brazos, con accionamiento a motor hidráulico y válvula de control, castillo de enganche de tres puntos categoría II.",
        "specs": [
            {"label": "Brazos rectos", "value": "6 brazos rectos en acero"},
            {"label": "Brazos curvos", "value": "3 brazos curvos en acero"},
            {"label": "Cajones y puntas", "value": "6 cajones y 3 puntas cincel"},
            {"label": "Barras cuadradas", "value": "Doble barra cuadrada de 2 ½\" x 3.20 m"},
            {"label": "Capacidad por tolva", "value": "120 kg c/u"},
            {"label": "Peso aprox.", "value": "600 kg"},
            {"label": "Potencia requerida", "value": "100 HP"},
            {"label": "Repuestos", "value": "Brazos rectos · Brazos curvos · Puntas cincel"},
        ],
        "features": [
            "Máquina totalmente desmontable, de fácil regulación, distanciamiento y altura de los brazos.",
            "Chasis en acero estructural.",
            "Accionamiento con motor hidráulico y válvula de control.",
            "Mangueras de alta presión hidráulicas.",
            "Castillo de enganche de tres puntos categoría II.",
            "Doble barra cuadrada de 2 ½\" x 3.20 m.",
            "6 brazos rectos en acero.",
            "3 brazos curvos en acero.",
            "6 cajones y 3 puntas cincel.",
            "Carteras con pernos de grado, regulables, para los brazos.",
            "Mangueras corrugadas adosables a los brazos rígidos.",
            "Capacidad por tolva: 120 kg c/u.",
        ],
        "dims": {"width": 320, "height": 0, "depth": 0, "weight": 600},
    },
    # ------------------------------------------------------------------ 18
    {
        "name": "ENCAMADORA INTEGRAL",
        "description": "Encamadora integral: forma la cama, tira la cinta de riego y coloca el plástico para el encamado, todo en un solo paso. Chasis en acero estructural y tubular, enganche tres puntos categoría II.",
        "specs": [
            {"label": "Ancho de cama", "value": "Según necesidad"},
            {"label": "Peso aprox.", "value": "600 kg"},
            {"label": "Potencia requerida", "value": "100 HP"},
        ],
        "features": [
            "Formador de cama, tira cinta de riego y coloca el plástico para el encamado, todo en un solo paso.",
            "Chasis en acero estructural y tubular.",
            "Enganche tres puntos, categoría II.",
            "Formador de cama: ancho según necesidad.",
            "Diskillers, con sus respectivas carteras y discos.",
            "Rodillos alineadores para cinta de riego.",
            "Llantas lisas pisa plástico para sellado de la cama.",
            "Diskiller para tapar plástico.",
            "2 vertederas.",
        ],
        "dims": {"width": 0, "height": 0, "depth": 0, "weight": 600},
    },
    # ------------------------------------------------------------------ 19
    {
        "name": "FORMADOR DE CAMA",
        "description": "Formador de cama fabricado en material acerado, castillo de enganche tres puntos categoría II, con 2 diskillers de disco liso Ø 28\" regulables para altura. Medidas de la cama según necesidad.",
        "specs": [
            {"label": "Barra", "value": "Barra sólida cuadrada en acero 2 ½\" x 2 ½\" x 2.0 m"},
            {"label": "Discos", "value": "2 diskillers con disco liso de Ø 28\""},
            {"label": "Medidas de la cama", "value": "Según necesidad"},
            {"label": "Peso aprox.", "value": "250 kg"},
            {"label": "Potencia requerida", "value": "90 HP"},
            {"label": "Repuestos", "value": "Diskiller"},
        ],
        "features": [
            "Fabricado en material acerado.",
            "Castillo de enganche tres puntos, categoría II.",
            "Barra sólida cuadrada en acero 2 ½\" x 2 ½\" x 2.0 m.",
            "Carteras para sujeción, de fácil desplazamiento horizontal.",
            "2 diskillers con disco liso de Ø 28\", regulables para altura.",
            "Medidas de la cama según necesidad.",
        ],
        "dims": {"width": 200, "height": 0, "depth": 0, "weight": 250},
    },
    # ------------------------------------------------------------------ 20
    {
        "name": "BORDERO AGRICOLA",
        "description": "Bordero agrícola fabricado en material de acero estructural y acero antidesgaste, castillo de enganche tres puntos categoría II, con 2 diskillers de disco liso Ø 28\" regulables para altura.",
        "specs": [
            {"label": "Barra", "value": "Barra sólida cuadrada acerada de 2 ½\" x 2 ½\" x 2.0 m"},
            {"label": "Discos", "value": "2 diskillers con disco liso de Ø 28\""},
            {"label": "Peso aprox.", "value": "180 kg"},
            {"label": "Potencia requerida", "value": "70 HP"},
        ],
        "features": [
            "Fabricado en material de acero estructural y acero antidesgaste.",
            "Castillo de enganche tres puntos, categoría II.",
            "Barra sólida cuadrada acerada de 2 ½\" x 2 ½\" x 2.0 m.",
            "Carteras para sujeción, de fácil desplazamiento horizontal.",
            "2 diskillers con disco liso de Ø 28\", regulables para altura.",
        ],
        "dims": {"width": 200, "height": 0, "depth": 0, "weight": 180},
    },
    # ------------------------------------------------------------------ 21
    {
        "name": "MOLINO DE MAIZ CON CICLON",
        "description": "Máquina adecuada para reducir el tamaño (partir y pulverizar) del maíz, con chasis en acero estructural, motor eléctrico trifásico de 6 HP y ciclón con caída para el ensaque. Rendimiento de 250 kg/hr.",
        "specs": [
            {"label": "Rendimiento", "value": "250 kg/hr"},
            {"label": "Motor eléctrico trifásico", "value": "6 HP"},
            {"label": "Martillos", "value": "Paquete de 36 martillos"},
            {"label": "Zarandas (cribas)", "value": "De recambio"},
        ],
        "features": [
            "Máquina adecuada para reducir el tamaño (partir y pulverizar).",
            "Chasis en acero estructural.",
            "Motor eléctrico trifásico de 6 HP situado en la zona posterior de la máquina.",
            "Poleas de doble vía que aseguran la transmisión de fuerza y movimiento.",
            "Tolva de fácil alimentación.",
            "Cámara de molienda con platinas de forma angular que evitan la recirculación del producto en la cámara, mejorando la eficiencia en el trabajo.",
            "Cámara inferior de proceso provista de un aspirador que evita la sobresaturación durante la molienda.",
            "Paquete de 36 martillos, con ciclón con caída para el ensaque.",
            "Zarandas (cribas) de recambio.",
        ],
        "dims": {"width": 0, "height": 0, "depth": 0, "weight": 0},
    },
    # ------------------------------------------------------------------ 22
    {
        "name": "DESBROZADORA DE ESPÁRRAGO",
        "description": "Desbrozadora de espárrago accionada por la toma de fuerza del tractor, ideal para limpieza del terreno antes de la cosecha. Chasis reforzado en acero estructural con sistema de enganche de 3 puntos.",
        "specs": [
            {"label": "Modelo", "value": "PPEFSI 1"},
            {"label": "Martillos", "value": "34 martillos"},
            {"label": "Ancho de trabajo", "value": "1.80 mt"},
            {"label": "Medidas de la máquina", "value": "2.30 mt ancho x 1.50 mt largo x 1.10 mt alto"},
            {"label": "Peso aprox.", "value": "650 kg"},
            {"label": "Potencia requerida", "value": "80 a 90 HP"},
            {"label": "Repuestos", "value": "Martillos con corbata larga · Martillos con corbata corta"},
        ],
        "features": [
            "Accionada por la toma de fuerza del tractor, ideal para limpieza del terreno antes de la cosecha.",
            "Chasis reforzado en acero estructural.",
            "Sistema de enganche 3 puntos.",
            "Cuenta con 34 martillos de acero anti abrasivo.",
            "2 poleas de accionamiento, fajas en \"V\".",
            "2 neumáticos, aro Nº 14.",
            "Cardan agrícola con funda protectora.",
        ],
        "dims": {"width": 230, "height": 110, "depth": 150, "weight": 650},
    },
    # ------------------------------------------------------------------ 23
    {
        "name": "RASTRA DE LEVANTE DE 20 x 22",
        "description": "Rastra de levante de 20 x 22, desarrollada especialmente para áreas pequeñas de difícil maniobra y con mucha declividad. Chasis reforzado en tubo cuadrado, 20 discos dentados de 22\" x 4 mm (acero al boro).",
        "specs": [
            {"label": "Discos", "value": "20 discos dentados de 22\" x 4 mm (acero al boro)"},
            {"label": "Limpiadores", "value": "20 limpiadores con soportes individuales y regulación"},
            {"label": "Distancia entre discos", "value": "230 mm"},
            {"label": "Ancho de trabajo", "value": "2.15 m"},
            {"label": "Profundidad de corte", "value": "0.15 m"},
            {"label": "Ejes", "value": "Ejes para discos en acero 1045 de Ø 1 ½\" pulg"},
            {"label": "Chumaceras", "value": "4 chumaceras radiales 230 mm para eje de 1 ½\" con protección de aceite"},
            {"label": "Peso aprox.", "value": "650 kg"},
            {"label": "Potencia requerida", "value": "70 HP"},
        ],
        "features": [
            "Desarrollada especialmente para áreas pequeñas de difícil maniobra y con mucha declividad.",
            "Chasis reforzado en tubo cuadrado.",
            "Castillo de enganche tres puntos categoría II.",
            "Platina para templador de rastra de 2 ½\" x 5/16\".",
            "Pernos y abrazaderas.",
            "Distancia entre discos: 230 mm.",
            "4 chumaceras radiales 230 mm para eje de 1 ½\" con protección de aceite.",
            "Ejes para discos en material de acero 1045 de Ø 1 ½\" pulg.",
            "20 discos dentados de 22\" x 4 mm (acero al boro).",
            "20 limpiadores con soportes individuales y regulación.",
            "Pines de enganche y sus respectivos seguros.",
            "Profundidad de corte: 0.15 m.",
            "Ancho de trabajo: 2.15 m.",
        ],
        "dims": {"width": 215, "height": 0, "depth": 0, "weight": 650},
    },
    # ------------------------------------------------------------------ 24
    {
        "name": "DESEMPLASTIFICADOR AGRÍCOLA RECOLECTOR DE PLÁSTICO Y CINTA",
        "description": "Equipo agrícola diseñado para la recolección eficiente de plástico y cinta de riego en los campos de cultivo. Incorpora un sistema hidráulico que facilita la operación, optimiza el tiempo de trabajo y contribuye al mantenimiento limpio y ordenado del terreno.",
        "specs": [
            {"label": "Ancho de trabajo", "value": "1.50 mt"},
            {"label": "Sistema", "value": "Hidráulico que facilita el enrollado del material"},
            {"label": "Recolección", "value": "Plástico y cintas de riego de diferentes medidas"},
        ],
        "features": [
            "Sistema hidráulico que facilita el enrollado del material.",
            "Capacidad de recolección de plástico y cintas de riego de diferentes medidas.",
            "Estructura reforzada para trabajo en campo abierto.",
            "Enganche a tractor de fácil instalación.",
            "Diseño compacto y resistente para uso continuo.",
            "Reduce el tiempo de recolección manual.",
            "Contribuye a mantener el terreno limpio y preparado para el siguiente cultivo.",
            "Ancho de trabajo: 1.50 mt.",
        ],
        "dims": {"width": 150, "height": 0, "depth": 0, "weight": 0},
    },
]

SQL = """
    UPDATE public.machine_products
    SET description = %(description)s,
        specifications = %(specifications)s,
        features = %(features)s,
        dimensions = %(dimensions)s
    WHERE name = %(name)s AND NOT deleted
"""


def main():
    conn = psycopg2.connect(os.getenv("DATABASE_URL"), cursor_factory=psycopg2.extras.RealDictCursor)
    updated = 0
    missing = []
    with conn.cursor() as cur:
        for p in PRODUCTS:
            params = {
                "name": p["name"],
                "description": p["description"],
                "specifications": json.dumps(p["specs"], ensure_ascii=False),
                "features": json.dumps(p["features"], ensure_ascii=False),
                "dimensions": json.dumps(p["dims"], ensure_ascii=False),
            }
            cur.execute(SQL, params)
            if cur.rowcount == 1:
                updated += 1
                print("OK  ", p["name"])
            else:
                missing.append(p["name"])
                print("FALTA", p["name"])
        conn.commit()
    conn.close()
    print("\nProductos actualizados:", updated, "/", len(PRODUCTS))
    if missing:
        print("No encontrados:", missing)


if __name__ == "__main__":
    main()