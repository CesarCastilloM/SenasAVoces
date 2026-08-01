"""Módulo de interpretación de LSM a oraciones en español con LangChain y OpenAI."""

import asyncio
import os
from dotenv import find_dotenv, load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate


class LSMInterpreter:
    """Convierte secuencias de palabras detectadas en LSM en oraciones coherentes.

    El modelo utiliza el orden jerárquico Tiempo-Lugar-Sujeto-Objeto-Verbo-Adverbio,
    aplica el tiempo de forma implícita para conjugar el verbo, y asume presente
    cuando no hay marca temporal explícita.
    """

    _SYSTEM_MESSAGE = (
        "Eres un experto lingüista en español. "
        "Recibirás una lista de secuencias de palabras. "
        "Cada secuencia representa una idea independiente estructurada generalmente "
        "en el orden: 1. Tiempo, 2. Lugar, 3. Sujeto, 4. Objeto, 5. Verbo, 6. Adverbio "
        "(aunque algunas categorías pueden omitirse o tener múltiples palabras). "
        "El primer elemento, cuando existe, es la marca de tiempo. "
        "Úsala exclusivamente como contexto para conjugar el verbo en el tiempo "
        "correcto (pasado, futuro, condicional, etc.). "
        "NO escribas la marca de tiempo textualmente en la oración final. "
        "Si la secuencia no comienza con una marca de tiempo, asume tiempo presente "
        "y conjuga el verbo en presente. "
        "Ejemplos: "
        "Input: 'Ayer oficina María reporte terminar rápidamente' -> "
        "Output: 'En la oficina, María terminó el reporte rápidamente.' "
        "Input: 'Mañana parque perro pelota traer' -> "
        "Output: 'En el parque, el perro traerá la pelota.' "
        "Input: 'casa Juan pizza comer felizmente' -> "
        "Output: 'En la casa, Juan come la pizza felizmente.' "
        "Tu tarea es interpretar cada secuencia de la lista y transformarla en una "
        "oración natural, fluida y gramaticalmente correcta en español. "
        "Devuelve una lista numerada con las oraciones finales resultantes, "
        "manteniendo el orden exacto en el que recibiste las secuencias originales. "
        "No incluyas texto extra, saludos ni explicaciones."
    )

    def __init__(self, model: str = "gpt-5.6-luna", temperature: float = 0.7) -> None:
        """Inicializa el intérprete cargando la API key y construyendo la cadena.

        Args:
            model: Nombre del modelo de OpenAI a utilizar.
            temperature: Temperatura de muestreo del modelo.

        Raises:
            RuntimeError: Si no se encuentra la variable de entorno OPENAI_API_KEY.
        """
        load_dotenv(find_dotenv())

        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY no está configurada.")

        self._llm = ChatOpenAI(
            model=model,
            api_key=api_key,
            temperature=temperature,
        )
        self._prompt = ChatPromptTemplate.from_messages(
            [
                ("system", self._SYSTEM_MESSAGE),
                ("human", "Aquí están las secuencias:\n\n{secuencias}"),
            ]
        )

    async def interpretar(self, secuencias: list[str]) -> list[str]:
        """Interpreta una lista de secuencias y devuelve las oraciones resultantes.

        Args:
            secuencias: Lista de cadenas con palabras/frases en orden LSM.

        Returns:
            Lista de oraciones generadas, una por cada secuencia recibida,
            respetando el mismo orden.
        """
        if not secuencias:
            return []

        bloque = "\n".join(
            f"{i + 1}. {secuencia}"
            for i, secuencia in enumerate(secuencias)
        )

        chain = self._prompt | self._llm
        response = await chain.ainvoke({"secuencias": bloque})
        return [
            line.strip()
            for line in response.content.splitlines()
            if line.strip()
        ]


async def interpretar_secuencias_lsm(secuencias: list[str]) -> list[str]:
    """Función de conveniencia para interpretar secuencias de LSM.

    Args:
        secuencias: Lista de cadenas con las palabras detectadas.

    Returns:
        Lista de oraciones interpretadas.
    """
    interprete = LSMInterpreter()
    return await interprete.interpretar(secuencias)


if __name__ == "__main__":
    secuencias_ejemplo: list[str] = [
        "Ayer oficina María reporte terminar rápidamente",
        "Mañana parque perro pelota traer",
        "casa Juan pizza comer felizmente",
    ]

    try:
        oraciones = asyncio.run(interpretar_secuencias_lsm(secuencias_ejemplo))
        for oracion in oraciones:
            print(oracion)
    except Exception as e:
        print(f"Error en la prueba: {e}")
