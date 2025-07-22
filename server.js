// server.js - Backend para Analizador de Estados de Cuenta
const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs').promises;
require('dotenv').config();
// Función auxiliar para limpiar respuestas de Claude
function cleanClaudeResponse(responseText) {
    // Remover markdown code blocks
    let cleaned = responseText
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
    
    // Encontrar el primer { y último } para extraer solo el JSON
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    
    return cleaned;
}
const app = express();

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: ['http://localhost:3000', 'https://railway.app', process.env.FRONTEND_URL || '*'],
    credentials: true
}));
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({extended: true, limit: '10mb'}));
app.use(express.static('public'));
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

// Función mejorada para llamar a Claude API con detección de tipo de cuenta
async function analyzeWithClaudeAPI(base64Data) {
    if (!process.env.CLAUDE_API_KEY) {
        throw new Error('CLAUDE_API_KEY no está configurada en las variables de entorno');
    }

    console.log('=== INICIANDO ANALISIS CON CLAUDE ===');
    console.log('Tamaño del PDF (base64):', base64Data.length);
    
    try {
        console.log('Paso 1: Detectando tipo de cuenta...');
        
        // PASO 1: Detectar tipo de cuenta primero
        const detectionPrompt = `
Analiza este PDF de estado de cuenta y detecta:

1. TIPO DE CUENTA:
   - Si es TARJETA DE CRÉDITO busca: "tarjeta de crédito", "pago mínimo", "fecha límite", "cargos regulares", "fecha de corte"
   - Si es CUENTA DE DÉBITO/CHEQUES busca: "cuenta de cheques", "saldo inicial", "saldo final", "retiros"

2. BANCO:
   - Santander, BBVA, Banamex, Banorte, HSBC, Nu, etc.

Responde SOLO con este JSON:
{
  "accountType": "CREDIT_CARD" o "DEBIT_ACCOUNT",
  "bankName": "SANTANDER",
  "confidence": 85
}
`;

        const detectionResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.CLAUDE_API_KEY,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 1000,
                messages: [{
                    role: "user",
                    content: [{
                        type: "document",
                        source: {
                            type: "base64",
                            media_type: "application/pdf",
                            data: base64Data,
                        },
                    }, {
                        type: "text",
                        text: detectionPrompt,
                    }],
                }],
            })
        });

        if (!detectionResponse.ok) {
            const errorData = await detectionResponse.text();
            console.error('Claude API Error en detección:', detectionResponse.status, errorData);
            throw new Error(`Claude API Error: ${detectionResponse.status} - ${errorData}`);
        }

        const detectionData = await detectionResponse.json();
        let detectionText = detectionData.content[0].text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        // Limpiar más agresivamente la respuesta de Claude
detectionText = cleanClaudeResponse(detectionData.content[0].text);
console.log('Texto de detección limpio:', detectionText);const detection = JSON.parse(detectionText);
        
        console.log('🔍 Tipo detectado:', detection.accountType, 'Banco:', detection.bankName);

        // PASO 2: Crear prompt específico según el tipo de cuenta
        let analysisPrompt;
        
        if (detection.accountType === 'CREDIT_CARD') {
            console.log('💳 Procesando como TARJETA DE CRÉDITO...');
            analysisPrompt = `
IMPORTANTE: Este es un estado de cuenta de TARJETA DE CRÉDITO de ${detection.bankName}.

REGLAS ESPECÍFICAS PARA TARJETAS DE CRÉDITO:
1. CARGOS/COMPRAS = GASTOS del usuario (usar amount NEGATIVO)
2. ABONOS/PAGOS = Pagos a la tarjeta (NO incluir como transacciones de gasto)
3. SOLO procesar la sección de "CARGOS" o "COMPRAS REGULARES"
4. IGNORAR completamente la sección de "ABONOS" o "PAGOS"

FECHAS SANTANDER: Formato "DD-MMM-YYYY" (ej: "15-JUN-2025")
- 15-ENE-2025 = 2025-01-15
- 28-FEB-2025 = 2025-02-28
- 12-MAR-2025 = 2025-03-12

BUSCAR SECCIÓN: "CARGOS, ABONOS Y COMPRAS REGULARES" o similar
FORMATO TÍPICO: DD-MMM-YYYY DD-MMM-YYYY DESCRIPCION $MONTO

CATEGORIZACIÓN:
- AMAZON, MERCADOLIBRE, LIVERPOOL = Compras
- UBER, GASOLINA, PEMEX, GO TAXI = Transporte  
- OXXO, WALMART, SORIANA = Alimentación
- CFE, TELMEX, IZZI, LUZ = Servicios
- NETFLIX, SPOTIFY = Entretenimiento
- FARMACIA, DOCTOR = Salud
- RENTA, HIPOTECA = Vivienda

Responde con JSON válido:
{
  "confidence": 85,
  "bankDetected": "${detection.bankName}",
  "accountType": "CREDIT_CARD",
  "transactions": [
    {
      "date": "2025-06-15",
      "description": "AMAZON MX COMPRA",
      "category": "Compras",
      "amount": -1200.50,
      "type": "gasto"
    }
  ],
  "summary": {
    "totalIncome": 0,
    "totalExpenses": -8632.36,
    "netBalance": -8632.36,
    "transactionCount": 15,
    "period": "Junio 2025"
  },
  "categoryBreakdown": {
    "Compras": -1200.50,
    "Servicios": -450.00
  }
}
`;
        } else {
            console.log('🏦 Procesando como CUENTA DE DÉBITO...');
            analysisPrompt = `
Este es un estado de cuenta de CUENTA DE DÉBITO/CHEQUES de ${detection.bankName}.

PROCESAR NORMALMENTE:
- Ingresos: depósitos, transferencias recibidas, nóminas (amount POSITIVO)
- Gastos: retiros, pagos, compras (amount NEGATIVO)

CATEGORIZACIÓN:
- AMAZON, MERCADOLIBRE = Compras
- UBER, GASOLINA, PEMEX = Transporte
- OXXO, WALMART, SORIANA = Alimentación
- CFE, TELMEX, IZZI = Servicios
- NETFLIX, SPOTIFY = Entretenimiento

Responde con JSON válido:
{
  "confidence": 85,
  "bankDetected": "${detection.bankName}",
  "accountType": "DEBIT_ACCOUNT",
  "transactions": [...],
  "summary": {
    "totalIncome": 5000.00,
    "totalExpenses": -3500.00,
    "netBalance": 1500.00,
    "transactionCount": 25,
    "period": "Junio 2025"
  },
  "categoryBreakdown": {...}
}
`;
        }

        // PASO 3: Análisis completo con prompt especializado
        console.log('Paso 2: Analizando transacciones...');
        
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.CLAUDE_API_KEY,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 4000,
                messages: [{
                    role: "user",
                    content: [{
                        type: "document",
                        source: {
                            type: "base64",
                            media_type: "application/pdf",
                            data: base64Data,
                        },
                    }, {
                        type: "text",
                        text: analysisPrompt,
                    }],
                }],
            })
        });

        console.log('Claude API response status:', response.status);

        if (!response.ok) {
            const errorData = await response.text();
            console.error('Claude API Error:', response.status, errorData);
            throw new Error(`Claude API Error: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        console.log('Claude API respuesta exitosa');
        
        if (!data.content || !data.content[0] || !data.content[0].text) {
            throw new Error('Respuesta de Claude API inválida');
        }

        let responseText = data.content[0].text;
        console.log('Respuesta de Claude (primeros 500 chars):', responseText.substring(0, 500));
        
        // Limpiar respuesta de markdown si existe
       responseText = cleanClaudeResponse(responseText);
        
        // Limpiar respuesta del análisis principal
responseText = cleanClaudeResponse(data.content[0].text);
console.log('Respuesta principal limpia (primeros 200 chars):', responseText.substring(0, 200));
        
        const parsedData = JSON.parse(responseText);        
        // Asegurar que tenga la información de detección
        parsedData.accountType = detection.accountType;
        parsedData.bankDetected = detection.bankName;
        
        console.log('✅ Análisis completado:');
        console.log('  - Tipo:', parsedData.accountType);
        console.log('  - Banco:', parsedData.bankDetected);
        console.log('  - Confianza:', parsedData.confidence);
        console.log('  - Transacciones:', parsedData.transactions?.length || 0);
        
        // Validar estructura mínima requerida
        if (!parsedData.transactions || !parsedData.summary) {
            throw new Error('Estructura de datos incompleta en la respuesta');
        }
        
        return parsedData;

    } catch (error) {
        console.error('=== ERROR EN CLAUDE API ===');
        console.error('Tipo de error:', error.name);
        console.error('Mensaje:', error.message);
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
