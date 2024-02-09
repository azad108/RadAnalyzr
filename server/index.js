const mysql = require('mysql');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const OpenAI = require("openai");
const dotenv = require('dotenv')
dotenv.config()
const functionModel = require('./function-model.json');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

const vectorDB = mysql.createConnection({
    host: process.env.DBHost,
    port: process.env.DBPort,
    user: process.env.DBUser,
    password: process.env.DBPassword,
    database: 'RadVectorDB',
});

vectorDB.connect();

app.get('/', (req, res) => {
    res.send("Hello World!");
});

// return the vector of a given string using OpenAI Embeddings API
const computeVector = async (str) => {
    const embedding = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: str,
        encoding_format: "float",
    });
    return embedding.data[0].embedding;
}

// save the vectors of each macroPhrase in macros in the vectorDB
const loadVectors = async (macros) => {
    for (const [macroPhrase, macroText] of Object.entries(macros)) {
        try {
            computeVector(macroPhrase)
                .then((macroVector) => {
                    const vectorJSON = JSON.stringify(macroVector);
                    vectorDB.query(`INSERT IGNORE INTO tbl_radvector (macro_phrase, macro_text, vector)
                                    VALUES (?, ?, JSON_ARRAY_PACK(?));
                                    `,
                                    [macroPhrase, macroText, vectorJSON],
                    (error, results) => {
                        if (error) throw error;
                    });
                });
        } catch (error) {
            console.error(`Error computing vector for ${macroPhrase}\n`, error);
        }
    }
}

// Find the macro text corresponding to the macroPhrase if ranks high against the existing macros
const findText = async (macroPhrase) => {
    computeVector(macroPhrase)
        .then((macroVector) => {
            const vectorJSON = JSON.stringify(macroVector);
            vectorDB.query(`SELECT macro_text, dot_product(vector, JSON_ARRAY_PACK(?)) as score
                                            FROM tbl_radvector
                            ORDER BY score DESC
                            limit 1;
                            `,
                            [JSON.stringify(macroVector)],
            (error, results) => {
                if (error) throw error;
                return results;
            });
        });
}

// use the function calling tool of OpenAI ChatCompletions API to analyze transcript 
// and return a templated version (//) of it by replacing commands such as `insert, input, embed, enter, fill, etc`
// Assumption: the text contains some words after a macro command and the command sentence is ended with a fullstop 
const analyzeTranscript = async (transcript) => {
    newPrompt = {
        role: "user",
        content: `Analyze the following transcript:'${transcript}'`
    }
    let messages = JSON.parse(JSON.stringify(functionModel.messages));
    messages.push(newPrompt);
    openai.chat.completions.create({
        "model": functionModel.model,
        "functions": functionModel.functions,
        "messages": JSON.parse(JSON.stringify(messages)),
        "response_format": { "type": "json_object" }
    }
        )
        .then((data) => {
            return JSON.parse(data.choices[0].message.function_call.arguments).modified_text;
        });
}

app.post('/analyze', (req, res) => {
    try {
        transcript = req.body.transcript;
        macros = JSON.parse(req.body.macros);
        // uncomment when the xlsx file being sent is updated
        //loadVectors(macros);
        //findText("diverticulitis moderate");
        
        analyzeTranscript(transcript)
            .then((analyzedTranscript) => {
                console.log(analyzedTranscript);
                res.json(analyzedTranscript);
            });
    } catch {
        throw("Unable to process POST request to /analyze");
    }
});

const port = process.env.PORT || 5050; 
app.listen(port, () =>
  console.log(`RadAnalyzr server listening on port: ${port}!`),
);