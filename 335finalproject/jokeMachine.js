const readline = require('node:readline');
const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const bodyParser = require('body-parser');
const https = require('https');
require('dotenv').config();

const app = express();

const mongoUser = process.env["MONGO_DB_USERNAME"];
const mongoPass = process.env["MONGO_DB_PASSWORD"];
const mongoDB = process.env["MONGO_DB_NAME"];
const mongoCollection = process.env["MONGO_COLLECTION"];
const cohereKey = process.env["COHERE_KEY"];

const uri = `mongodb+srv://${mongoUser}:${mongoPass}@jokecluster.6tsxl.mongodb.net/?retryWrites=true&w=majority&appName=JokeCluster`;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let database;
let collection;

async function initMongo() {
    await client.connect();
    database = await client.db(mongoDB);
    collection = database.collection(mongoCollection);
}

async function fetchChatHistory(email) {
    const results = await collection.find({ email: email }).toArray();
    let outputHTML = `<hr class="historyhr"><p class="historyHeader">User History</p>`;
    if (results.length > 0) {
        results.reverse();
        for (let i = 0; i < results.length && i < 10; i++) {
            outputHTML += `<hr class="historyhr"><p class="historyText">${results[i].jokeText}</p>`;
        }
    }
    return outputHTML;
}

async function storeChatHistory(email, joke) {
    const result = await collection.insertOne({
        email: email,
        jokeText: joke,
    });

    return result;
}

function fetchJoke(jokeType) {
    if (jokeType == "") {
        jokeType = "funny"
    }

    const url = "https://api.cohere.com/v2/chat";
    const options = {
        method: "POST",
        headers: {
            "accept": "application/json",
            "content-type": "application/json",
            "Authorization": "Bearer " + cohereKey
        }
    };

    const payload = JSON.stringify({
        model: "command-r-plus-08-2024",
        messages: [
            {
                role: "user",
                content: "Generate a random joke with the following style: " + jokeType + ". Do not explain the joke. Just give me the joke with no words in front. Do not use any slurs."
            }
        ],
        temperature: 0.95
    });

    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(new Error("Failed to parse response: " + error.message));
                }
            });
        });

        req.write(payload);
        req.end();
    });
}

class CommandLineInterpreter {
    #ioStream;

    constructor() {
        this.#ioStream = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
    }

    prompt() {
        this.#ioStream.question("Type stop to shutdown the server: ", cmd => {
            if (cmd === "stop") {
                console.log("Shutting down the server");
                process.exit(0);
            } else {
                console.log(`Invalid command: ${cmd}`);
                this.prompt();
            }
        });
    }
}

const args = process.argv.slice(2);
if (args.length !== 1) {
    console.log("Usage: node jokeMachine.js {port}");
    process.exit(1);
}

app.set('view engine', 'ejs');
app.set('views', './templates');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get("/", (req, res) => res.render("index", { jokeBody: "" }));

app.post("/joke", async (req, res) => {
    let { email, jokeType } = req.body;
    history = "";
    if (email != "") {
        history = await fetchChatHistory(email);
    }

    let rawResponse = await fetchJoke(jokeType);
    textResponse = "Error: rate limited. Slow down jokester!"
    if (rawResponse.message.content != undefined) {
        let responseObj = rawResponse.message.content[0];
        textResponse = responseObj.text;
    }
    
    let body = `
        <p class="jokeText">${textResponse}</p>
    ` + history;

    if (email != "" && textResponse != "Error: rate limited. Slow down jokester!") {
        storeChatHistory(email, textResponse)
    }

    res.render("index", { jokeBody: body });
});

let port = args[0];
initMongo().then(() => {
    app.listen(port, () => {
        console.log(`Webserver started and running at http://localhost:${port}`);
        let interpreter = new CommandLineInterpreter();
        interpreter.prompt();
    });
})