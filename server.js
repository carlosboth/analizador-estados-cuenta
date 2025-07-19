{
  "name": "analizador-estados-cuenta",
  "version": "1.0.0",
  "description": "Analizador de estados de cuenta bancarios con Claude AI",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "deploy": "vercel --prod"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "multer": "^1.4.5-lts.1",
    "dotenv": "^16.3.1",
    "node-fetch": "^3.3.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=16.0.0"
  },
  "keywords": [
    "claude-ai",
    "pdf-analysis",
    "banking",
    "finance",
    "mexico"
  ],
  "author": "Tu Nombre",
  "license": "MIT"
}
