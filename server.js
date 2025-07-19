// server.js - Backend para Analizador de Estados de Cuenta
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs').promises;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: ['http://localhost:3000', 'https://railway.app', process.env.FRONTEND_URL || '*'],
    credentials: true
}));
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({extended: true, limit: '10mb'}));

// Configurar multer para archivos
const upload = multer({ 
    dest: 'uploads/',
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// Crear directorio uploads si no existe
const createUploadsDir = async () => {
    try {
        await fs.mkdir('uploads', { recursive: true });
    } catch (error) {
        console.log('Directorio uploads ya existe o error:', error.message);
    }
};

// Endpoint principal - servir la aplicación
// Servir archivos estáticos
app.use(express.static('public'));

// Endpoint principal - servir la aplicación desde public/index.html  
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint para procesar PDFs desde base64
app.post('/api/analyze-base64', async (req, res) => {
    try {
        const { base64Data } = req.body;
        
        if (!base64Data) {
            return res.status(400).json({ error: 'No se proporcionó base64Data' });
        }

        console.log('Procesando PDF desde base64...');
        const analysisResult = await analyzeWithClaudeAPI(base64Data);
        console.log('Análisis completado exitosamente');

        res.json(analysisResult);

    } catch (error) {
        console.error('Error procesando base64:', error);
        res.status(500).json({ 
            error: 'Error procesando el archivo',
            details: error.message 
        });
    }
});

// Endpoint para procesar PDFs desde archivo
app.post('/api/analyze-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se proporcionó archivo PDF' });
        }

        console.log('Procesando archivo PDF:', req.file.originalname);

        // Leer archivo PDF como base64
        const fileBuffer = await fs.readFile(req.file.path);
        const base64Data = fileBuffer.toString('base64');

        // Llamar a Claude API
        const analysisResult = await analyzeWithClaudeAPI(base64Data);

        // Limpiar archivo temporal
        await fs.unlink(req.file.path);

        console.log('Análisis completado exitosamente');
        res.json(analysisResult);

    } catch (error) {
        console.error('Error procesando PDF:', error);
        
        // Limpiar archivo temporal en caso de error
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
            } catch {}
        }

        res.status(500).json({ 
            error: 'Error procesando el archivo',
            details: error.message 
        });
    }
});

// Función para llamar a Claude API
async function analyzeWithClaudeAPI(base64Data) {
    if (!process.env.CLAUDE_API_KEY) {
        throw new Error('CLAUDE_API_KEY no está configurada en las variables de entorno');
    }

    const prompt = `
Analiza este estado de cuenta bancario PDF mexicano y extrae la información de transacciones.

INSTRUCCIONES ESPECÍFICAS:
1. Extrae TODAS las transacciones identificando: fecha, descripción completa, y monto
2. Para BANCOS MEXICANOS comunes (BBVA, Santander, Banamex, HSBC, Banorte, Scotiabank)
3. Categoriza en: Alimentación, Transporte, Vivienda, Entretenimiento, Salud, Educación, Compras, Servicios, Transferencias, Otros
4. Identifica tipo: "ingreso" (depósitos, transferencias recibidas) o "gasto" (retiros, pagos, compras)
5. Maneja formatos de fecha mexicanos (DD/MM/YYYY o DD-MM-YYYY)
6. Reconoce montos en pesos mexicanos ($X,XXX.XX o $X.XXX,XX)

PATRONES COMUNES A BUSCAR:
- OXXO, 7ELEVEN, SORIANA, WALMART = Alimentación
- UBER, GASOLINA, PEMEX = Transporte  
- CFE, TELMEX, IZZI, MEGACABLE = Servicios
- NETFLIX, SPOTIFY, AMAZON = Entretenimiento

Responde ÚNICAMENTE con JSON válido:
{
  "confidence": 85,
  "bankDetected": "BBVA Bancomer",
  "transactions": [
    {
      "date": "2024-01-15",
      "description": "COMPRA OXXO CENTRO DF",
      "category": "Alimentación", 
      "amount": -150.50,
      "type": "gasto"
    }
  ],
  "summary": {
    "totalIncome": 15000,
    "totalExpenses": -8500,
    "netBalance": 6500,
    "transactionCount": 45,
    "period": "Enero 2024"
  },
  "categoryBreakdown": {
    "Alimentación": -2500,
    "Transporte": -1200
  }
}

CRÍTICO: Solo responde JSON válido, sin texto adicional.
    `;

    try {
        console.log('Llamando a Claude API...');
        
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.CLAUDE_API_KEY,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: "claude-3-sonnet-20240229",
                max_tokens: 4000,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "document",
                                source: {
                                    type: "base64",
                                    media_type: "application/pdf",
                                    data: base64Data,
                                },
                            },
                            {
                                type: "text",
                                text: prompt,
                            },
                        ],
                    },
                ],
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('Claude API Error:', response.status, errorData);
            throw new Error(`Claude API Error: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        
        if (!data.content || !data.content[0] || !data.content[0].text) {
            throw new Error('Respuesta de Claude API inválida');
        }

        let responseText = data.content[0].text;
        console.log('Respuesta de Claude recibida, parseando...');
        
        // Limpiar respuesta de markdown si existe
        responseText = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        
        // Validar que sea JSON válido
        const parsedData = JSON.parse(responseText);
        
        // Validar estructura mínima requerida
        if (!parsedData.transactions || !parsedData.summary) {
            throw new Error('Estructura de datos incompleta en la respuesta');
        }
        
        console.log('Análisis completado:', parsedData.summary.transactionCount, 'transacciones encontradas');
        return parsedData;

    } catch (error) {
        console.error('Error en Claude API:', error);
        throw error;
    }
}

// Endpoint de salud
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
        claudeApiConfigured: !!process.env.CLAUDE_API_KEY
    });
});

// Endpoint de prueba
app.get('/test', (req, res) => {
    res.json({
        message: 'Servidor funcionando correctamente',
        endpoints: [
            'GET /',
            'POST /api/analyze-base64',
            'POST /api/analyze-pdf', 
            'GET /health',
            'GET /test'
        ]
    });
});

// Manejo de errores globales
app.use((error, req, res, next) => {
    console.error('Error no manejado:', error);
    res.status(500).json({
        error: 'Error interno del servidor',
        message: error.message
    });
});

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        availableEndpoints: [
            'GET /',
            'POST /api/analyze-base64',
            'POST /api/analyze-pdf',
            'GET /health'
        ]
    });
});

// Inicializar servidor
const startServer = async () => {
    await createUploadsDir();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
        console.log(`📊 Health check: http://localhost:${PORT}/health`);
        console.log(`🔑 Claude API Key: ${process.env.CLAUDE_API_KEY ? 'Configurada ✅' : 'No configurada ❌'}`);
        console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
    });
};

startServer().catch(console.error);

module.exports = app;
