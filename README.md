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
