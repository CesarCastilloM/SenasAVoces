"""
Vocabulario LSM (Lenguaje de Señas Mexicano)
Base de datos de gestos comunes con patrones de referencia

Autor: César
Fecha: Abril 2026
"""

# ==================== VOCABULARIO LSM ====================

LSM_VOCABULARY = {
    # SALUDOS Y CORTESÍA
    "hola": {
        "description": "Mano derecha abierta, movimiento de saludo",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_gyro_y": 45}
    },
    "buenos días": {
        "description": "Mano derecha señalando arriba (sol)",
        "pattern": {"right_flex": [0, 30000, 30000, 30000, 30000], "right_gyro_z": 90}
    },
    "buenas tardes": {
        "description": "Mano derecha horizontal (sol bajando)",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_gyro_y": 0}
    },
    "buenas noches": {
        "description": "Mano derecha señalando abajo (luna)",
        "pattern": {"right_flex": [0, 30000, 30000, 30000, 30000], "right_gyro_z": -90}
    },
    "adiós": {
        "description": "Mano derecha abierta, movimiento de despedida",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_gyro_x": 30}
    },
    "gracias": {
        "description": "Mano derecha desde barbilla hacia adelante",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_y": 5}
    },
    "por favor": {
        "description": "Mano derecha circular sobre pecho",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_gyro_z": 180}
    },
    "perdón": {
        "description": "Mano derecha en círculo sobre pecho",
        "pattern": {"right_flex": [15000, 0, 0, 0, 0], "right_gyro_z": 90}
    },
    "disculpa": {
        "description": "Similar a perdón",
        "pattern": {"right_flex": [15000, 0, 0, 0, 0], "right_gyro_z": 90}
    },
    
    # PRONOMBRES
    "yo": {
        "description": "Dedo índice apuntando a uno mismo",
        "pattern": {"right_flex": [30000, 0, 30000, 30000, 30000], "right_accel_y": -5}
    },
    "tú": {
        "description": "Dedo índice apuntando hacia adelante",
        "pattern": {"right_flex": [30000, 0, 30000, 30000, 30000], "right_accel_y": 5}
    },
    "él": {
        "description": "Dedo índice apuntando a la derecha",
        "pattern": {"right_flex": [30000, 0, 30000, 30000, 30000], "right_gyro_z": 45}
    },
    "ella": {
        "description": "Dedo índice apuntando a la derecha",
        "pattern": {"right_flex": [30000, 0, 30000, 30000, 30000], "right_gyro_z": 45}
    },
    "nosotros": {
        "description": "Dedo índice circular",
        "pattern": {"right_flex": [30000, 0, 30000, 30000, 30000], "right_gyro_z": 360}
    },
    
    # VERBOS COMUNES
    "querer": {
        "description": "Manos hacia el pecho",
        "pattern": {"both_flex": [15000, 15000, 15000, 15000, 15000], "both_accel_y": -3}
    },
    "necesitar": {
        "description": "Mano derecha cerrada, movimiento hacia abajo",
        "pattern": {"right_flex": [30000, 30000, 30000, 30000, 30000], "right_accel_z": -5}
    },
    "tener": {
        "description": "Manos cerradas frente al pecho",
        "pattern": {"both_flex": [30000, 30000, 30000, 30000, 30000]}
    },
    "hacer": {
        "description": "Puños golpeándose",
        "pattern": {"both_flex": [30000, 30000, 30000, 30000, 30000], "both_accel_x": 5}
    },
    "ir": {
        "description": "Dedos índice y medio caminando",
        "pattern": {"right_flex": [30000, 0, 0, 30000, 30000], "right_accel_y": 3}
    },
    "venir": {
        "description": "Mano hacia uno mismo",
        "pattern": {"right_flex": [30000, 0, 30000, 30000, 30000], "right_accel_y": -3}
    },
    "comer": {
        "description": "Dedos juntos hacia la boca",
        "pattern": {"right_flex": [15000, 15000, 15000, 15000, 15000], "right_accel_z": 5}
    },
    "beber": {
        "description": "Mano en forma de vaso hacia boca",
        "pattern": {"right_flex": [30000, 0, 0, 0, 30000], "right_accel_z": 5}
    },
    "dormir": {
        "description": "Mano abierta junto a la cabeza",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_gyro_x": 45}
    },
    "trabajar": {
        "description": "Puños alternados",
        "pattern": {"both_flex": [30000, 30000, 30000, 30000, 30000], "both_accel_y": 3}
    },
    "estudiar": {
        "description": "Mano abierta frente a frente",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_y": 2}
    },
    "ayudar": {
        "description": "Mano derecha sobre izquierda, movimiento hacia arriba",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_accel_z": 5}
    },
    "entender": {
        "description": "Dedo índice a la frente",
        "pattern": {"right_flex": [30000, 0, 30000, 30000, 30000], "right_accel_z": 3}
    },
    "saber": {
        "description": "Dedos en la frente",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_z": 3}
    },
    
    # FAMILIA
    "mamá": {
        "description": "Mano abierta en la barbilla",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_z": 2}
    },
    "papá": {
        "description": "Mano abierta en la frente",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_z": 3}
    },
    "hermano": {
        "description": "Dedos índices juntos",
        "pattern": {"both_flex": [30000, 0, 30000, 30000, 30000]}
    },
    "hermana": {
        "description": "Similar a hermano",
        "pattern": {"both_flex": [30000, 0, 30000, 30000, 30000]}
    },
    "hijo": {
        "description": "Mano derecha desde frente hacia abajo",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_z": -3}
    },
    "hija": {
        "description": "Similar a hijo",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_z": -3}
    },
    "familia": {
        "description": "Manos en círculo",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_gyro_z": 180}
    },
    
    # EMOCIONES
    "feliz": {
        "description": "Manos abiertas movimiento hacia arriba",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_accel_z": 5}
    },
    "triste": {
        "description": "Manos bajando por la cara",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_accel_z": -5}
    },
    "enojado": {
        "description": "Manos cerradas tensas",
        "pattern": {"both_flex": [30000, 30000, 30000, 30000, 30000], "both_accel_x": 3}
    },
    "cansado": {
        "description": "Manos caídas",
        "pattern": {"both_flex": [15000, 15000, 15000, 15000, 15000], "both_accel_z": -3}
    },
    "preocupado": {
        "description": "Mano en la frente",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_z": 2}
    },
    
    # LUGARES
    "casa": {
        "description": "Manos formando techo",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_gyro_x": 45}
    },
    "escuela": {
        "description": "Manos aplaudiendo",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_accel_x": 5}
    },
    "trabajo": {
        "description": "Puños alternados",
        "pattern": {"both_flex": [30000, 30000, 30000, 30000, 30000]}
    },
    "hospital": {
        "description": "Cruz con dedos índices",
        "pattern": {"both_flex": [30000, 0, 30000, 30000, 30000]}
    },
    "tienda": {
        "description": "Mano abierta, movimiento de dar",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_y": 3}
    },
    
    # COMIDA Y BEBIDA
    "agua": {
        "description": "Mano en W hacia boca",
        "pattern": {"right_flex": [30000, 0, 0, 0, 30000], "right_accel_z": 3}
    },
    "leche": {
        "description": "Mano ordeñando",
        "pattern": {"right_flex": [15000, 15000, 15000, 15000, 15000], "right_accel_z": -3}
    },
    "pan": {
        "description": "Manos como cortando",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_accel_y": 3}
    },
    "carne": {
        "description": "Pellizcar con dedos",
        "pattern": {"right_flex": [15000, 15000, 30000, 30000, 30000]}
    },
    "fruta": {
        "description": "Mano en la mejilla",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_x": 2}
    },
    "café": {
        "description": "Mano moliendo",
        "pattern": {"right_flex": [30000, 30000, 30000, 30000, 30000], "right_gyro_z": 180}
    },
    
    # NÚMEROS (0-10)
    "cero": {
        "description": "Mano en O",
        "pattern": {"right_flex": [15000, 15000, 15000, 15000, 15000]}
    },
    "uno": {
        "description": "Dedo índice arriba",
        "pattern": {"right_flex": [30000, 0, 30000, 30000, 30000]}
    },
    "dos": {
        "description": "Dedos índice y medio",
        "pattern": {"right_flex": [30000, 0, 0, 30000, 30000]}
    },
    "tres": {
        "description": "Dedos índice, medio y anular",
        "pattern": {"right_flex": [30000, 0, 0, 0, 30000]}
    },
    "cuatro": {
        "description": "Cuatro dedos arriba",
        "pattern": {"right_flex": [30000, 0, 0, 0, 0]}
    },
    "cinco": {
        "description": "Mano abierta",
        "pattern": {"right_flex": [0, 0, 0, 0, 0]}
    },
    "seis": {
        "description": "Pulgar y meñique",
        "pattern": {"right_flex": [0, 30000, 30000, 30000, 0]}
    },
    "siete": {
        "description": "Pulgar, índice y meñique",
        "pattern": {"right_flex": [0, 0, 30000, 30000, 0]}
    },
    "ocho": {
        "description": "Pulgar, índice, medio y meñique",
        "pattern": {"right_flex": [0, 0, 0, 30000, 0]}
    },
    "nueve": {
        "description": "Todos menos anular",
        "pattern": {"right_flex": [0, 0, 0, 30000, 0]}
    },
    "diez": {
        "description": "Dos manos abiertas",
        "pattern": {"both_flex": [0, 0, 0, 0, 0]}
    },
    
    # PALABRAS ÚTILES
    "sí": {
        "description": "Puño movimiento arriba-abajo",
        "pattern": {"right_flex": [30000, 30000, 30000, 30000, 30000], "right_accel_z": 3}
    },
    "no": {
        "description": "Dedo índice movimiento lado a lado",
        "pattern": {"right_flex": [30000, 0, 30000, 30000, 30000], "right_accel_x": 5}
    },
    "bien": {
        "description": "Pulgar arriba",
        "pattern": {"right_flex": [0, 30000, 30000, 30000, 30000]}
    },
    "mal": {
        "description": "Pulgar abajo",
        "pattern": {"right_flex": [0, 30000, 30000, 30000, 30000], "right_gyro_z": 180}
    },
    "más": {
        "description": "Dedos juntos, movimiento hacia arriba",
        "pattern": {"right_flex": [15000, 15000, 15000, 15000, 15000], "right_accel_z": 3}
    },
    "menos": {
        "description": "Mano horizontal",
        "pattern": {"right_flex": [30000, 0, 30000, 30000, 30000], "right_gyro_y": 0}
    },
    "mucho": {
        "description": "Manos separándose",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_accel_x": 5}
    },
    "poco": {
        "description": "Dedos índice y pulgar juntos",
        "pattern": {"right_flex": [15000, 15000, 30000, 30000, 30000]}
    },
    "todo": {
        "description": "Manos en círculo grande",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_gyro_z": 360}
    },
    "nada": {
        "description": "Manos abiertas, movimiento de negación",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_accel_x": -5}
    },
    
    # TIEMPO
    "hoy": {
        "description": "Manos hacia abajo",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_accel_z": -2}
    },
    "mañana": {
        "description": "Mano hacia adelante",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_y": 5}
    },
    "ayer": {
        "description": "Mano hacia atrás",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_y": -5}
    },
    "ahora": {
        "description": "Manos hacia abajo rápido",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_accel_z": -5}
    },
    "después": {
        "description": "Mano derecha adelante",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_y": 3}
    },
    "antes": {
        "description": "Mano derecha atrás",
        "pattern": {"right_flex": [0, 0, 0, 0, 0], "right_accel_y": -3}
    },
    
    # FRASES COMPLETAS COMUNES
    "¿cómo estás?": {
        "description": "Secuencia: cómo + estar + tú",
        "pattern": {"sequence": ["cómo", "estar", "tú"]}
    },
    "me llamo": {
        "description": "Secuencia: yo + nombre",
        "pattern": {"sequence": ["yo", "nombre"]}
    },
    "mucho gusto": {
        "description": "Manos desde pecho hacia adelante",
        "pattern": {"both_flex": [0, 0, 0, 0, 0], "both_accel_y": 5}
    },
    "te quiero": {
        "description": "Dedos índice, medio y pulgar extendidos",
        "pattern": {"right_flex": [0, 0, 30000, 30000, 0]}
    },
    "te amo": {
        "description": "Puño sobre corazón",
        "pattern": {"right_flex": [30000, 30000, 30000, 30000, 30000], "right_accel_x": -3}
    },
    "no entiendo": {
        "description": "Secuencia: no + entender",
        "pattern": {"sequence": ["no", "entender"]}
    },
    "¿me ayudas?": {
        "description": "Secuencia: ayudar + yo + pregunta",
        "pattern": {"sequence": ["ayudar", "yo"]}
    },
    "por favor ayuda": {
        "description": "Secuencia: por favor + ayudar",
        "pattern": {"sequence": ["por favor", "ayudar"]}
    },
}

# ==================== ALFABETO LSM (DACTILOLÓGICO) ====================

LSM_ALPHABET = {
    "A": {"right_flex": [30000, 30000, 30000, 30000, 30000]},  # Puño cerrado
    "B": {"right_flex": [0, 0, 0, 0, 0]},  # Mano abierta
    "C": {"right_flex": [15000, 15000, 15000, 15000, 15000]},  # Mano en C
    "D": {"right_flex": [30000, 0, 30000, 30000, 30000]},  # Índice arriba
    "E": {"right_flex": [15000, 15000, 15000, 15000, 15000]},  # Dedos doblados
    "F": {"right_flex": [15000, 15000, 0, 0, 0]},  # OK invertido
    "G": {"right_flex": [0, 0, 30000, 30000, 30000]},  # Pulgar e índice
    "H": {"right_flex": [0, 0, 0, 30000, 30000]},  # Tres dedos
    "I": {"right_flex": [30000, 30000, 30000, 30000, 0]},  # Meñique
    "J": {"right_flex": [30000, 30000, 30000, 30000, 0]},  # Meñique con movimiento
    "K": {"right_flex": [30000, 0, 0, 30000, 30000]},  # Índice y medio en V
    "L": {"right_flex": [0, 0, 30000, 30000, 30000]},  # L con mano
    "M": {"right_flex": [0, 30000, 30000, 30000, 30000]},  # Pulgar bajo dedos
    "N": {"right_flex": [0, 0, 30000, 30000, 30000]},  # Dos dedos bajo pulgar
    "Ñ": {"right_flex": [0, 0, 0, 30000, 30000]},  # Tres dedos bajo pulgar
    "O": {"right_flex": [15000, 15000, 15000, 15000, 15000]},  # Círculo
    "P": {"right_flex": [30000, 0, 0, 30000, 30000]},  # K hacia abajo
    "Q": {"right_flex": [0, 0, 30000, 30000, 30000]},  # G hacia abajo
    "R": {"right_flex": [30000, 0, 0, 30000, 30000]},  # Índice y medio cruzados
    "S": {"right_flex": [30000, 30000, 30000, 30000, 30000]},  # Puño
    "T": {"right_flex": [0, 30000, 30000, 30000, 30000]},  # Pulgar entre dedos
    "U": {"right_flex": [30000, 0, 0, 30000, 30000]},  # Índice y medio juntos
    "V": {"right_flex": [30000, 0, 0, 30000, 30000]},  # V con dedos
    "W": {"right_flex": [30000, 0, 0, 0, 30000]},  # Tres dedos
    "X": {"right_flex": [30000, 15000, 30000, 30000, 30000]},  # Índice doblado
    "Y": {"right_flex": [0, 30000, 30000, 30000, 0]},  # Pulgar y meñique
    "Z": {"right_flex": [30000, 0, 30000, 30000, 30000]},  # Z con índice
}

# ==================== CATEGORÍAS ====================

LSM_CATEGORIES = {
    "saludos": ["hola", "buenos días", "buenas tardes", "buenas noches", "adiós", "gracias", "por favor", "perdón"],
    "pronombres": ["yo", "tú", "él", "ella", "nosotros"],
    "verbos": ["querer", "necesitar", "tener", "hacer", "ir", "venir", "comer", "beber", "dormir", "trabajar", "estudiar", "ayudar", "entender", "saber"],
    "familia": ["mamá", "papá", "hermano", "hermana", "hijo", "hija", "familia"],
    "emociones": ["feliz", "triste", "enojado", "cansado", "preocupado"],
    "lugares": ["casa", "escuela", "trabajo", "hospital", "tienda"],
    "comida": ["agua", "leche", "pan", "carne", "fruta", "café"],
    "números": ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"],
    "útiles": ["sí", "no", "bien", "mal", "más", "menos", "mucho", "poco", "todo", "nada"],
    "tiempo": ["hoy", "mañana", "ayer", "ahora", "después", "antes"],
    "frases": ["¿cómo estás?", "me llamo", "mucho gusto", "te quiero", "te amo", "no entiendo", "¿me ayudas?", "por favor ayuda"],
}

def get_vocabulary_size():
    """Retorna el tamaño del vocabulario LSM"""
    return len(LSM_VOCABULARY)

def get_category_words(category):
    """Retorna palabras de una categoría específica"""
    return LSM_CATEGORIES.get(category, [])

def get_all_categories():
    """Retorna todas las categorías disponibles"""
    return list(LSM_CATEGORIES.keys())

def search_word(word):
    """Busca una palabra en el vocabulario"""
    return LSM_VOCABULARY.get(word.lower(), None)

if __name__ == "__main__":
    print(f"📚 Vocabulario LSM cargado: {get_vocabulary_size()} palabras/frases")
    print(f"📂 Categorías: {', '.join(get_all_categories())}")
    print(f"🔤 Alfabeto: {len(LSM_ALPHABET)} letras")
