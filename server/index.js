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

// Custom error handling middleware 
app.use((err, req, res, next) => { 
    console.error(err.stack); 
    res.status(500).json( 
        { message: 'Something went wrong in the server!' }); 
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
                    vectorDB.query(`INSERT IGNORE INTO tbl_radvector (macro_phrase, macro_text, vector)
                                    VALUES (?, ?, JSON_ARRAY_PACK(?));
                                    `,
                                    [macroPhrase, macroText, vectorJSON],
                    (error, results) => {
                        if (error) throw error;
                    });
                })
                .catch((err) => {throw err});
        } catch (error) {
            console.error(`Error while computing vector for ${macroPhrase}\n`, error);
        }
    }
}

// Find the highest ranked macro text corresponding to the macroPhrase
// whose vector scores the highest against the vectors of existing macros
const findTextFor = async (macroPhrase) => {
    try {
        const macroVector = await computeVector(macroPhrase);
        if (macroVector) {
            vectorDB.query(`SELECT macro_text, dot_product(vector, JSON_ARRAY_PACK(?)) as score
                                            FROM tbl_radvector
                            ORDER BY score DESC
                            limit 1;
                            `,
                            [JSON.stringify(macroVector)],
            (error, results) => {
                if (error) throw error;
                console.log(results);
                return results[0].RowDataPacket;
            });
        }
    }
    catch (err){
        console.log(`Error encountered while finding macro text for ${macroPhrase}.\n`, err);
    }
}

// use the function calling tool of OpenAI ChatCompletions API to analyze transcript 
// and return a templated version (//) of it by replacing commands such as `insert, input, embed, enter, fill, etc`
// Assumption: the text contains some words after a macro command and the command sentence is ended with a fullstop 
const analyzeTranscript = async (transcript) => {
    try {
        newPrompt = {
            role: "user",
            content: `Analyze the following transcript:'${transcript}'`
        }
        let messages = JSON.parse(JSON.stringify(functionModel.messages));
        messages.push(newPrompt);
        const response = await openai.chat.completions.create({
            "model": functionModel.model,
            "functions": functionModel.functions,
            "messages": JSON.parse(JSON.stringify(messages))
        });
        const modifiedText = JSON.parse(response.choices[0].message.function_call.arguments).modified_text;
        return modifiedText;
            
    } catch (err) {
        console.log(`Error encountered while analyzing transcript:\n${transcript}\n`, err)
    }
}


const sliceAnalyzed = async (analyzedTranscript) => {
    try {
        const analyzedTranscript = await analyzeTranscript(transcript);
        if (analyzedTranscript) {
            return analyzedTranscript.split('');
        }
    } catch (err) {
        console.log(`Error encountered while slicing analyzed transcript:\n`, err)
    }
}

const refillNewTranscriptWithMacroTexts = async (newTranscript, macroData) => {
    // find score for each macroPhrase in macroData and add it to the newTranscript if it has score > 90 (ie high confidence)
    // change newTranscript[index] to the string contained from macro_text
    try {
        for ([index, macroPhrase] of macroData) {
            console.log(index, " ", macroPhrase)
            if (macroPhrase.length > 0) {
                const response = await findTextFor(macroPhrase);
                if (response) {
                    console.log("macro_response, "+response)
                    if (response.score > 0.9) {
                        const macroText = response.macro_text;
                        newTranscript[index] = macroText;
                    } else {
                        const thisPhrase = macroPhrase + ".";
                        newTranscript[index] = thisPhrase;
                    }
                    console.log("from refillNewTranscriptWithMacroTexts: \n" , newTranscript)
                    return newTranscript;
                }
            }
        }
    } catch (err) {
        console.log(`Error encountered while inside refillNewTranscriptWithMacroTexts:\n`, err);
    }    

}
const enhanceTranscript = async (transcript) => {
    try {
        const result = await sliceAnalyzed(transcript) 
        let newTranscript = [];
        let i = 0;
        console.log('print from ENHANCE!')
        console.log('analyzedTranscript:', result);
        
        // stack of all phrases_texts to update in array
        const macroData = []
        while(i < result.length) {
            // what to do if '//' is encountered in the transcript result
            if (result[i] === '/' && i+1 < result.length && result[i+1] === '/' && i++ && i++) {
                console.log(i, "// encountered", result[i]);
                // iterate through transcript to find the first fullstop signalling end of current sentence.
                let firstChar = false;
                // this_phrase will be the command context if it exists
                let this_phrase = "";
                while (i < result.length && result[i] !== '.') {
                    console.log(i, " ====inside phrasing==== ",result[i]);
                    // it's not the first character after the // and the first letter of the macro phrase
                    if (!firstChar && /\s/.test(result[i]) && i+1 < result.length) {
                        i++;
                    } else {
                        firstChar = true;
                        this_phrase += result[i];
                        i++;
                    }
                }
                console.log(this_phrase)
                // macroData[i][0] -> the index where to put the macro text 
                // macroData[i][1] -> this_phrase
                macroData.push([newTranscript.length, this_phrase]);
            } else {
                console.log(i, " ============== ",result[i])
                newTranscript.push(result[i]);
            }
            i++;
        }
        const response = await refillNewTranscriptWithMacroTexts(newTranscript, macroData);
        console.log(response);
        return response;
    } catch (err) {
        console.log(`Error encountered while enhancing transcript:\n`, err);
    }
}

app.post('/analyze', async (req, res, next) => {
    try {
        transcript = req.body.transcript;
        macros = JSON.parse(req.body.macros);
        // uncomment when the xlsx file being sent is updated to update DB instance
        //loadVectors(macros);
        const finalTranscript = await enhanceTranscript(transcript);
        res.json(finalTranscript);
    } catch (error) {
        next(error);
    }
});

const port = process.env.PORT || 5050; 
app.listen(port, () =>
  console.log(`RadAnalyzr server listening on port: ${port}!`),
);