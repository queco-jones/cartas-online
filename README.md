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
