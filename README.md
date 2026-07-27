# Cartas contra tus amigos

Juego online sencillo de preguntas y respuestas para jugar en salas privadas.

## Requisitos

- Node.js 18 o superior.
- Visual Studio Code.

## Cómo ejecutarlo

1. Abre esta carpeta en VS Code.
2. Abre una terminal integrada.
3. Ejecuta:

```bash
npm install
```

4. Después ejecuta:

```bash
npm start
```

5. Abre en el navegador:

```text
http://localhost:3000
```

## Cómo probarlo en un mismo ordenador

Abre varias ventanas de incógnito o usa distintos navegadores. Cada ventana contará como un jugador diferente.

## Jugar con amigos desde otras casas

`localhost` solo funciona dentro de tu ordenador. Para jugar por Internet tendrás que publicar el proyecto en un servicio como Render o Railway.

## Cambiar las cartas

Edita `cards.json`.

- `black`: preguntas o frases con hueco.
- `white`: respuestas.

Mantén siempre las comillas, las comas y los corchetes del formato JSON.

## Reglas actuales

- Entre 3 y 12 jugadores.
- 10 cartas por jugador.
- El juez rota cada ronda.
- El anfitrión inicia la partida y pasa a la siguiente ronda.
- El servidor guarda las partidas solo en memoria. Si se reinicia, las salas desaparecen.


## Cartas negras con varios huecos
Las cartas negras pueden ser texto normal o un objeto con etiqueta `pick`:
```json
{"text": "____ + ____ = ____.", "pick": 3}
```
El juego también detecta automáticamente el número de `____`, pero la etiqueta permite revisarlo o modificarlo manualmente.

## Persistencia de cartas creadas y moderación

Las cartas creadas se guardan en `custom-cards.json`. Las cartas aprobadas por votación quedan registradas en `flagged-cards.json`, y las eliminadas definitivamente en `deleted-cards.json`.

En Render, configura `DATA_DIR` apuntando a un Persistent Disk para conservar estos archivos tras reinicios o despliegues. Sin disco persistente, Render puede borrar los cambios guardados en tiempo de ejecución.

## Partidas por rondas y generación con IA

Al crear una sala, el anfitrión elige entre 5 y 30 rondas. Tras cada ronda, quienes hayan jugado responden una encuesta rápida. Al terminar se muestra clasificación, podio y estadísticas.

Para activar la creación automática de cartas al finalizar, configura en Render:

- `OPENAI_API_KEY`: tu clave de la API de OpenAI.
- `OPENAI_MODEL`: opcional; por defecto `gpt-5-mini`.
- `DATA_DIR`: ruta del disco persistente, por ejemplo `/var/data`.

Las cartas generadas se guardan en `custom-cards.json` y se incorporan inmediatamente al mazo. Las estadísticas anónimas de las últimas 100 partidas se guardan en `game-analytics.json`.

## Modos de juego

- **Original:** un jugador actúa como juez y elige la mejor respuesta anónima.
- **Modo Caos:** todos envían respuesta. Cuando todos terminan, las respuestas se muestran mezcladas y sin autor. Cada jugador vota una respuesta que no sea la suya. Si la primera posición queda empatada, nadie gana el punto. Los autores se revelan al cerrar la ronda.

## Versión 10 — cartas generadas y selectores personalizados

- Cuando la IA termina, aparece el botón **Mostrar nuevas cartas** en la pantalla final.
- El botón abre una ventana con las 8 cartas negras y 16 blancas generadas en esa partida.
- Las cartas mostradas ya están guardadas en `custom-cards.json` y cargadas en el mazo.
- Todos los desplegables de la interfaz usan ahora un selector personalizado adaptado al diseño claro y oscuro.


## Cartas generadas por IA

Las cartas generadas al terminar una partida se incorporan directamente al mazo general persistente:

- Con `DATA_DIR=/var/data`: `/var/data/cards.json`
- En local sin `DATA_DIR`: `cards.json` del proyecto

Además, `ai-generated-cards.json` conserva únicamente la lista de cartas creadas por IA para poder darles prioridad sin duplicarlas físicamente en las manos.

Las cartas de IA tienen por defecto peso 4 frente al peso 1 de una carta normal. Esto hace que tiendan a aparecer antes en los mazos barajados, manteniendo cada carta una sola vez por ciclo. El peso puede cambiarse con la variable `AI_CARD_WEIGHT`, entre 2 y 8.

## Guardado permanente gratuito mediante GitHub

Esta versión guarda las cartas generadas por IA directamente en el `cards.json` del repositorio de GitHub. El commit provoca automáticamente un nuevo despliegue en Render cuando el servicio está conectado al repositorio.

Configura estas variables en **Render → Environment**:

```text
GITHUB_TOKEN=tu_token
GITHUB_REPOSITORY=usuario/nombre-del-repositorio
GITHUB_BRANCH=main
GITHUB_CARDS_PATH=cards.json
```

`GITHUB_BRANCH` y `GITHUB_CARDS_PATH` pueden omitirse si la rama es `main` y el archivo está en la raíz.

El token recomendado es un **fine-grained personal access token** limitado únicamente a este repositorio y con el permiso **Contents: Read and write**. No escribas el token dentro del código ni lo subas a GitHub.

Las cartas generadas también quedan registradas dentro del propio `cards.json`, en `_aiGenerated`, para que sigan teniendo la prioridad configurada con `AI_CARD_WEIGHT` después de cada nuevo despliegue.
