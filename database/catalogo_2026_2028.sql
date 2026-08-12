-- ============================================================================
-- CATÁLOGO 2026-2028 - FSI SAC / EL IQUEÑO
-- Inserción de productos (maquinaria agrícola) en machine_products
-- Las filas se saltan si ya existe un producto con el mismo nombre.
-- ============================================================================

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'COSECHADORA DE PAPA Y/O CAMOTE CON CAJA IMPORTADA',
    'Cosechadora con enganche de tres puntos, diseñada para todo tipo de terreno agrícola. Cardan T4, cadenas reforzadas que permiten una labor perfecta y segura.',
    0,
    '[{"label":"Modelo","value":"CPFSI 65 - CPFSI 70 - CPFSI 75 - CPFSI 79"},{"label":"Cuerpo delantero","value":"65 - 70 - 75 - 79 cm"},{"label":"Cuerpo posterior","value":"70 - 75 - 79 cm"},{"label":"Eslabones cadena delantera","value":"62"},{"label":"Eslabones cadena posterior","value":"40"},{"label":"Peso aprox.","value":"380 - 420 - 450 - 480 Kg"},{"label":"Potencia requerida","value":"40 a 70 HP"},{"label":"Tipo de cosecha","value":"CAMOTE - CAMOTE - PAPA - PAPA"}]',
    '["Enganche de tres puntos para todo tipo de terreno agrícola","Cardan T4 para cosechadora","Cadenas reforzadas"]',
    '{"width":0,"height":0,"depth":0,"weight":480}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'COSECHADORA DE PAPA Y/O CAMOTE CON CAJA IMPORTADA');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'COSECHADORA DE PAPA CON DESCARGA LATERAL',
    'Cosechadora de papa con descarga lateral, enganche de tres puntos, chasis metálico en plancha de acero estructural y cardan telescópico T4 marca AEMCO.',
    0,
    '[{"label":"Dimensiones","value":"2.40m largo x 1.50m ancho x 1.20m alto"},{"label":"Eslabones cadena delantera","value":"60 unidades"},{"label":"Eslabones cadena posterior","value":"50 unidades"},{"label":"Peso aprox.","value":"480 Kg"},{"label":"Potencia requerida","value":"70 HP"}]',
    '["Enganche de tres puntos para todo tipo de terreno agrícola","Chasis metálico en plancha de acero estructural","Transmisión con 2 cajas de engranaje mediante corona y piñón, con sistema de embrague","Accesorios: trompos, batidores, rodillos y piñones","Cardan telescópico con protección (T4) MARCA AEMCO"]',
    '{"width":150,"height":120,"depth":240,"weight":480}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'COSECHADORA DE PAPA CON DESCARGA LATERAL');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'COSECHADORA DE PAPA CON COLA LARGA',
    'Cosechadora de papa con cola larga, enganche de tres puntos, ejes de transmisión en acero SAE 1045 y cardan telescópico T4 marca AEMCO.',
    0,
    '[{"label":"Dimensiones","value":"2.80m largo x 1.50m ancho x 1.20m alto"},{"label":"Eslabones cadena delantera","value":"60 unidades"},{"label":"Eslabones cadena posterior","value":"55 unidades"},{"label":"Peso aprox.","value":"480 Kg"},{"label":"Potencia requerida","value":"70 HP"}]',
    '["Enganche de tres puntos para todo tipo de terreno agrícola","Ejes de transmisión en acero SAE 1045","Chasis metálico en plancha de acero estructural","Accesorios: trompos, batidores, rodillos y piñones","Cardan telescópico con protección (T4) MARCA AEMCO"]',
    '{"width":150,"height":120,"depth":280,"weight":480}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'COSECHADORA DE PAPA CON COLA LARGA');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'CULTIVADORA DE BRAZOS RÍGIDOS CON VERTEDERAS REGULABLES',
    'Cultivadora de brazos rígidos con vertederas regulables, barra cuadrada acerada, equipo totalmente desmontable.',
    0,
    '[{"label":"Modelo","value":"CULFSI 1 - CULFSI 2"},{"label":"Brazos rectos","value":"3 - 6"},{"label":"Brazos curvos","value":"6 - 3"},{"label":"Dimensiones de barra","value":"2 ½ x 2 ½ x 3mt"},{"label":"Profundidad de trabajo","value":"25 cm"},{"label":"Peso aprox.","value":"400 Kg"},{"label":"Potencia requerida","value":"50 a 65 HP"}]',
    '["Barra cuadrada acerada","Equipo totalmente desmontable","Carteras con pernos oscilantes","Fácil regulación, distanciamiento y altura de los brazos","Castillo de enganche de tres puntos","Uñas desmontables y reversibles"]',
    '{"width":300,"height":0,"depth":0,"weight":400}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'CULTIVADORA DE BRAZOS RÍGIDOS CON VERTEDERAS REGULABLES');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'MINICULTIVADORA DE BRAZOS RIGIDOS',
    'Minicultivadora de brazos rígidos, barra cuadrada, equipo totalmente desmontable con puntas V desmontables y reversibles.',
    0,
    '[{"label":"Modelo","value":"SURFSI 1 - SURFSI 2"},{"label":"Brazos rectos","value":"2 - 4"},{"label":"Dimensiones de barra","value":"2\" x 2\" x 1mt"},{"label":"Peso aprox.","value":"80 - 100 Kg"},{"label":"Potencia requerida","value":"16 a 20 HP"},{"label":"Profundidad de trabajo","value":"10 a 15 cm"}]',
    '["Barra cuadrada","Equipo totalmente desmontable","Carteras con pernos oscilantes","Fácil regulación, distanciamiento y altura de los brazos","Castillo de enganche de tres puntos","Puntas V desmontables y reversibles"]',
    '{"width":50,"height":70,"depth":100,"weight":120}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'MINICULTIVADORA DE BRAZOS RIGIDOS');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'SURCADORA DE BRAZOS RIGIDOS',
    'Surcadora de brazos rígidos, barra cuadrada acerada, equipo totalmente desmontable con cajones estándar.',
    0,
    '[{"label":"Modelo","value":"SURBFSI 1 - SURBFSI 2"},{"label":"Brazos rectos","value":"2 - 3"},{"label":"Dimensiones de barra","value":"2.5\" x 2.5\" x 2.5mt"},{"label":"Peso aprox.","value":"275 - 300 Kg"},{"label":"Potencia requerida","value":"50 a 65 HP"},{"label":"Profundidad de trabajo","value":"70 cm"}]',
    '["Barra cuadrada acerada","Equipo totalmente desmontable","Carteras con pernos oscilantes","Fácil regulación, distanciamiento y altura de los brazos","Castillo de enganche de tres puntos","Cajones estándar"]',
    '{"width":250,"height":0,"depth":0,"weight":300}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'SURCADORA DE BRAZOS RIGIDOS');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'SUBSOLADOR',
    'Subsolador de chasis tubular en perfil rectangular, brazos curvos en acero antiabrasivo y puntas desmontables intercambiables.',
    0,
    '[{"label":"Modelo","value":"SUBFSI 1 - SUBFSI 2 - SUBFSI 3"},{"label":"Brazos","value":"1 - 2 - 3"},{"label":"Distancia entre brazos","value":"60 a 80 cm"},{"label":"Profundidad de trabajo","value":"70 cm"},{"label":"Peso aprox.","value":"150 - 330 - 400 Kg"},{"label":"Potencia requerida","value":"50 a 120 HP"}]',
    '["Chasis tubular en perfil rectangular","Brazos curvos en acero antiabrasivo","Puntas desmontables intercambiables","Fácil regulación"]',
    '{"width":0,"height":0,"depth":0,"weight":400}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'SUBSOLADOR');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'PICADORA DE HOJA DE PAPA CON BOMBÍN HIDRÁULICO',
    'Picadora de hoja de papa accionada por la toma de fuerza del tractor, ideal para limpieza del terreno antes de la cosecha de papa/camote.',
    0,
    '[{"label":"Modelo","value":"PPBFSI 1 - PPBFSI 2"},{"label":"Martillos","value":"34 - 38"},{"label":"Ancho de trabajo","value":"1.80 - 2.00 mt"},{"label":"Medidas de la máquina","value":"2.30m ancho x 2.50m largo x 1.10m alto / 2.50m ancho x 2.50m largo x 1.10m alto"},{"label":"Peso aprox.","value":"650 - 700 Kg"},{"label":"Potencia requerida","value":"80 a 90 HP"}]',
    '["Accionada por la toma de fuerza del tractor, ideal para limpieza del terreno antes de la cosecha de papa/camote","Chasis reforzado en acero estructural","Sistema de arrastre de tiro","Asistido con sistema hidráulico"]',
    '{"width":250,"height":110,"depth":250,"weight":700}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'PICADORA DE HOJA DE PAPA CON BOMBÍN HIDRÁULICO');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'PICADORA DE HOJA DE PAPA CON ENGANCHE TRES PUNTOS',
    'Picadora de hoja de papa accionada por la toma de fuerza del tractor con sistema de enganche de 3 puntos.',
    0,
    '[{"label":"Modelo","value":"PPEFSI 1 - PPEFSI 2"},{"label":"Martillos","value":"34 - 38"},{"label":"Ancho de trabajo","value":"1.80 - 2.00 mt"},{"label":"Medidas de la máquina","value":"2.30m ancho x 2.30m largo x 1.10m alto / 2.50m ancho x 2.30m largo x 1.10m alto"},{"label":"Peso aprox.","value":"650 - 680 Kg"},{"label":"Potencia requerida","value":"80 a 100 HP"}]',
    '["Accionada por la toma de fuerza del tractor, ideal para limpieza del terreno antes de la cosecha de papa","Chasis reforzado en acero estructural","Sistema de enganche 3 puntos","34 martillos de acero anti abrasivo","2 poleas de accionamiento, fajas en V","2 neumáticos, aro Nº 14","Cardan agrícola con funda protectora"]',
    '{"width":250,"height":110,"depth":230,"weight":680}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'PICADORA DE HOJA DE PAPA CON ENGANCHE TRES PUNTOS');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'PICADORA DE CHALA ESTACIONARIA',
    'Picadora ideal para cortar caña, pasto, malezas y todo tipo de forrajes. Accionada a motor eléctrico trifásico.',
    0,
    '[{"label":"Modelo","value":"PCHFSI 1 - PCHFSI 2"},{"label":"Cuchillas","value":"8"},{"label":"Capacidad de producción","value":"2 a 4 TN / Hora - 3 a 5 TN / Hora"},{"label":"Medidas de la máquina","value":"0.80m ancho x 2m largo x 1.80m alto / 1.20m ancho x 2m largo x 1.80m alto"},{"label":"Peso aprox.","value":"180 - 650 Kg"},{"label":"Potencia requerida (motor)","value":"10 - 20 HP"}]',
    '["Picadora ideal para cortar caña, pasto, malezas y todo tipo de forrajes","Chasis en acero estructural","Tolva de alimentación manual y salida por ducto cuello de cisne","Poleas, fajas y chumacera de pie","Piñones de accionamiento y cadena de transmisión","Caja accionada a motor eléctrico trifásico"]',
    '{"width":120,"height":180,"depth":200,"weight":650}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'PICADORA DE CHALA ESTACIONARIA');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'HOYADORA AGRICOLA',
    'Hoyadora de enganche de tres puntos accionada con la toma de fuerza del tractor, chasis en acero tubular rectangular.',
    0,
    '[{"label":"Modelo","value":"HBFSI 1 - HBFSI 2 - HBFSI 3 - HBFSI 4"},{"label":"Broca N°","value":"Ø 12\" - Ø 16\" - Ø 21\" - Según necesidad"},{"label":"Altura del hoyo","value":"Ø 6\" a Ø 8\" según necesidad"},{"label":"Medidas de la máquina","value":"1mt ancho x 1.70mt largo x 1.70mt alto"},{"label":"Peso aprox.","value":"180 - 200 Kg"},{"label":"Potencia requerida","value":"70 HP"}]',
    '["Hoyadora de enganche de tres puntos accionada con chasis en acero tubular rectangular","Caja reductora","Embrague para caja reductora","Cardan con protección accionado con la toma de fuerza del tractor","Barreno de perforación reforzado","Juego de cuchillas aceradas"]',
    '{"width":100,"height":170,"depth":170,"weight":200}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'HOYADORA AGRICOLA');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'COSECHADORA DE CEBOLLA',
    'Cosechadora de cebolla con chasis en acero estructural reforzado, enganche de tres puntos categoría II.',
    0,
    '[{"label":"Ancho de trabajo","value":"1.80mt"},{"label":"Dimensiones","value":"1.90m largo x 0.90m ancho x 1.30m alto"},{"label":"Peso aprox.","value":"400 Kg"},{"label":"Potencia requerida","value":"50 a 65 HP"}]',
    '["Chasis fabricado en acero estructural reforzado","Enganche tres puntos, categoría II","Caja central de engranaje y piñones","Barra cuadrada en acero 1045","Ruedas de corte con regulador de profundidad","Punta cincel en cada brazo"]',
    '{"width":90,"height":130,"depth":190,"weight":400}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'COSECHADORA DE CEBOLLA');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'DESGRANADORA DE MAIZ DURO',
    'Desgranadora de maíz duro accionada por la toma de fuerza del tractor, producción de 14 a 16 Tn/hr.',
    0,
    '[{"label":"Producción","value":"14 a 16 Tn/hr"},{"label":"Dimensiones","value":"1.20m ancho x 1.5m alto x 2.0m largo"},{"label":"Peso aprox.","value":"350 Kg"},{"label":"Potencia requerida","value":"70 HP"}]',
    '["Material en acero estructural","Enganche tres puntos categoría II","Cardan accionada para toma de fuerza de tractor","Piñones y cadena para transmisión del sistema","Tambor interior de desgrane","Tolva para ingreso de mazorcas","Ductos de salida de granos y coronta"]',
    '{"width":120,"height":150,"depth":200,"weight":350}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'DESGRANADORA DE MAIZ DURO');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'MOLINO O PULVERIZADOR DE CASCARA DE COCO',
    'Trituradora y molienda de coco seco con chasis en acero estructural, producción requerida de 500 kg/h.',
    0,
    '[{"label":"Producción requerida","value":"500 kg/h"},{"label":"Tolva de ingreso","value":"50cm x 50cm de coco seco"},{"label":"Zarandas de trituración","value":"Ø 1\", Ø 3/4\""},{"label":"Zaranda de pulverización","value":"Ø 3mm, 2mm"},{"label":"Motor trifásico","value":"10 HP"}]',
    '["Trituradora y molienda de coco seco","Chasis en acero estructural","48 martillos acerados para trituración","48 martillos acerados para pulverización","Ventilador de succión de polvillo (2 paletas)","Ciclón con caída para 2 salidas del polvillo de pulverización","4 poleas y fajas en V","Chumaceras de pared","Tablero para control de encendido y apagado"]',
    '{"width":0,"height":0,"depth":0,"weight":0}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'MOLINO O PULVERIZADOR DE CASCARA DE COCO');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'CARRETA AGRICOLA PARA COSECHA',
    'Carreta agrícola basculante baja y/o alta, chasis en acero estructural con plataforma en plancha estriada, capacidad de carga 2 Tn.',
    0,
    '[{"label":"Capacidad de carga","value":"2 Tn"},{"label":"Altura del piso a plataforma","value":"50 o 70cm"},{"label":"Ancho de plataforma","value":"2.00m"},{"label":"Longitud de plataforma","value":"3.60m"},{"label":"Llantas","value":"4 llantas radiales aro Nº13"},{"label":"Cambios de medida","value":"Según necesidad"}]',
    '["Altura del piso a plataforma 50 o 70cm","Chasis fabricado en acero estructural","Plataforma de carreta en plancha estriada","Soporte de llantas en sistema PIVOT basculante","Baranda delantera y laterales (volcables)","Tiro de enganche delantero y posterior, para remolque","Parante de auto soporte"]',
    '{"width":200,"height":70,"depth":360,"weight":0}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'CARRETA AGRICOLA PARA COSECHA');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'LAMPON AGRÍCOLA DE LEVANTE',
    'Lampón agrícola de levante fabricado en plancha y perfiles de acero estructural, con cuchilla en acero antidesgaste.',
    0,
    '[{"label":"Ancho de trabajo","value":"3.00m"},{"label":"Profundidad","value":"10 cm"},{"label":"Altura de trabajo","value":"50cm"},{"label":"Peso aprox.","value":"450 Kg"},{"label":"Potencia requerida","value":"100 HP"}]',
    '["Fabricado en plancha y perfiles de acero estructural","Cuchilla en acero antidesgaste","Castillo de enganche 3 puntos"]',
    '{"width":300,"height":50,"depth":0,"weight":450}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'LAMPON AGRÍCOLA DE LEVANTE');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'ABONADORA HIDRÁULICA',
    'Abonadora hidráulica totalmente desmontable con accionamiento por motor hidráulico y válvula de control.',
    0,
    '[{"label":"Brazos rectos","value":"6"},{"label":"Brazos curvos","value":"3"},{"label":"Cajones","value":"6"},{"label":"Puntas cincel","value":"3"},{"label":"Barras cuadradas","value":"2 1/2\" x 3.20m (doble)"},{"label":"Capacidad por tolva","value":"120kg c/u"},{"label":"Peso aprox.","value":"600 Kg"},{"label":"Potencia requerida","value":"100 HP"}]',
    '["Máquina totalmente desmontable, de fácil regulación, distanciamiento y altura de los brazos","Chasis en acero estructural","Accionamiento con motor hidráulico y válvula de control","Mangueras de alta presión hidráulicas","Castillo de enganche de tres puntos categoría II","Carteras con pernos de grado, regulables, para los brazos","Mangueras corrugadas adosables a los brazos rígidos"]',
    '{"width":320,"height":0,"depth":0,"weight":600}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'ABONADORA HIDRÁULICA');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'ENCAMADORA INTEGRAL',
    'Formador de cama, tira cinta de riego y coloca el plástico para el encamado, todo en un solo paso.',
    0,
    '[{"label":"Ancho de cama","value":"Según necesidad"},{"label":"Peso aprox.","value":"600 Kg"},{"label":"Potencia requerida","value":"100 HP"}]',
    '["Formador de cama, tira cinta de riego y coloca el plástico para el encamado, todo en un solo paso","Chasis en acero estructural y tubular","Enganche tres puntos, categoría II","Diskillers con sus respectivas carteras y discos","Rodillos alineadores para cinta de riego","Llantas lisas pisa plástico para sellado","Diskiller para tapar plástico","2 vertederas"]',
    '{"width":0,"height":0,"depth":0,"weight":600}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'ENCAMADORA INTEGRAL');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'FORMADOR DE CAMA',
    'Formador de cama fabricado en material acerado con 2 diskillers de disco liso Ø28" regulables para altura.',
    0,
    '[{"label":"Barra","value":"2 1/2\" x 2 1/2\" x 2.0m (sólida cuadrada)"},{"label":"Discos","value":"2 diskiller con disco liso Ø28\""},{"label":"Medidas de la cama","value":"Según necesidad"},{"label":"Peso aprox.","value":"250 Kg"},{"label":"Potencia requerida","value":"90 HP"}]',
    '["Fabricado en material acerado","Castillo de enganche tres puntos, categoría II","Barra sólida cuadrada en acero 2 1/2 x 2 1/2 x 2.0 m","Carteras para sujeción, de fácil desplazamiento horizontal","2 diskiller con disco liso de Ø28, regulables para altura","Medidas de la cama según necesidad"]',
    '{"width":200,"height":0,"depth":0,"weight":250}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'FORMADOR DE CAMA');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'BORDERO AGRICOLA',
    'Bordero agrícola fabricado en acero estructural y antidesgaste con 2 diskillers de disco liso Ø28" regulables.',
    0,
    '[{"label":"Barra","value":"2 1/2\" x 2 1/2\" x 2.0m (sólida cuadrada)"},{"label":"Discos","value":"2 diskiller con disco liso Ø28\""},{"label":"Peso aprox.","value":"180 Kg"},{"label":"Potencia requerida","value":"70 HP"}]',
    '["Fabricado en material acero estructural y acero antidesgaste","Castillo de enganche tres puntos, categoría II","Barra sólida cuadrada acerada de 2 1/2 x 2 1/2 x 2.0m","Carteras para sujeción, de fácil desplazamiento horizontal","2 diskiller con disco liso de Ø28, regulables para altura"]',
    '{"width":200,"height":0,"depth":0,"weight":180}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'BORDERO AGRICOLA');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'MOLINO DE MAIZ CON CICLON',
    'Máquina adecuada para reducir el tamaño (partir y pulverizar) del maíz, con rendimiento de 250 kg/hr.',
    0,
    '[{"label":"Rendimiento","value":"250 kg/hr"},{"label":"Motor eléctrico trifásico","value":"6 HP"},{"label":"Martillos","value":"36"},{"label":"Zarandas (cribas)","value":"De recambio"}]',
    '["Maquina adecuada para reducir el tamaño (partir y pulverizar)","Chasis en acero estructural","Motor eléctrico trifásico de 6 HP situado en la zona posterior","Poleas de doble vía que aseguran la transmisión de fuerza y movimiento","Tolva de fácil alimentación","Cámara de molienda con platinas angulares que evitan la recirculación del producto","Cámara inferior provista de un aspirador que evita la sobresaturación","Paquete de 36 martillos, con ciclón con caída para el ensaque","Zarandas (cribas) de recambio"]',
    '{"width":0,"height":0,"depth":0,"weight":0}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'MOLINO DE MAIZ CON CICLON');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'DESBROZADORA DE ESPÁRRAGO',
    'Desbrozadora de espárrago accionada por la toma de fuerza del tractor, ideal para limpieza del terreno antes de la cosecha.',
    0,
    '[{"label":"Modelo","value":"PPEFSI 1"},{"label":"Martillos","value":"34"},{"label":"Ancho de trabajo","value":"1.80 mt"},{"label":"Medidas de la máquina","value":"2.30m ancho x 1.50m largo x 1.10m alto"},{"label":"Peso aprox.","value":"650 Kg"},{"label":"Potencia requerida","value":"80 a 90 HP"}]',
    '["Accionada por la toma de fuerza del tractor, ideal para limpieza del terreno antes de la cosecha","Chasis reforzado en acero estructural","Sistema de enganche 3 puntos","34 martillos de acero anti abrasivo","2 poleas de accionamiento, fajas en V","2 neumáticos, aro Nº 14","Cardan agrícola con funda protectora"]',
    '{"width":230,"height":110,"depth":150,"weight":650}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'DESBROZADORA DE ESPÁRRAGO');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'RASTRA DE LEVANTE DE 20 x 22',
    'Rastra de levante desarrollada especialmente para áreas pequeñas de difícil maniobra y con mucha declividad.',
    0,
    '[{"label":"Discos","value":"20 discos dentados de 22\" x 4mm (acero al boro)"},{"label":"Distancia entre discos","value":"230mm"},{"label":"Ancho de trabajo","value":"2.15m"},{"label":"Profundidad de corte","value":"0.15m"},{"label":"Peso aprox.","value":"650 Kg"},{"label":"Potencia requerida","value":"70 HP"}]',
    '["Desarrollada especialmente para áreas pequeñas de difícil maniobra y con mucha declividad","Chasis reforzado en tubo cuadrado","Castillo de enganche tres puntos categoría II","Platina para templador de rastra de 2 1/2 X 5/16","4 chumaceras radiales 230mm para eje de 1 1/2 con protección","Ejes para discos en acero 1045 de Ø 1 1/2 pulg","20 discos dentados de 22 x 4mm (acero al boro)","20 limpiadores con soportes individuales y regulación","Pines de enganche y sus respectivos seguros"]',
    '{"width":215,"height":0,"depth":0,"weight":650}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'RASTRA DE LEVANTE DE 20 x 22');

INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions)
SELECT
    'DESEMPLASTIFICADOR AGRÍCOLA RECOLECTOR DE PLÁSTICO Y CINTA',
    'Equipo agrícola diseñado para la recolección eficiente de plástico y cinta de riego en los campos de cultivo, con sistema hidráulico.',
    0,
    '[{"label":"Ancho de trabajo","value":"1.50 mt"}]',
    '["Sistema hidráulico que facilita el enrollado del material","Capacidad de recolección de plástico y cintas de riego de diferentes medidas","Estructura reforzada para trabajo en campo abierto","Enganche a tractor de fácil instalación","Diseño compacto y resistente para uso continuo","Reduce el tiempo de recolección manual","Contribuye a mantener el terreno limpio y preparado para el siguiente cultivo"]',
    '{"width":150,"height":0,"depth":0,"weight":0}'
WHERE NOT EXISTS (SELECT 1 FROM public.machine_products WHERE name = 'DESEMPLASTIFICADOR AGRÍCOLA RECOLECTOR DE PLÁSTICO Y CINTA');

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
SELECT id, name, price, created_at FROM public.machine_products WHERE NOT deleted ORDER BY id;