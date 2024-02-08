const mysql = require('mysql');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const OpenAI = require("openai");
const dotenv = require('dotenv')
dotenv.config()

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

// 
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
                console.log(results)
                return results;
            });
        });
}

app.post('/analyze', (req, res) => {
    try {
        transcript = req.body.transcript;
        macros = JSON.parse(req.body.macros);
        loadVectors(macros);
        findText("diverticulitis moderate");
    } catch {
        throw("Unable to process POST request to /analyze");
    }
});

const port = process.env.PORT || 5050;
app.listen(port, () =>
  console.log(`RadAnalyzr server listening on port: ${port}!`),
);