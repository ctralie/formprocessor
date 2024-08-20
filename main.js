const https = require('https');
const fs = require('fs');
const JSEncrypt = require('node-jsencrypt');
const crypto = require('crypto').webcrypto;
const util = require('util');
const exec = util.promisify(require('child_process').exec);
var sleep = require('sleep'); // npm install sleep

// Load in constants
const constants = JSON.parse(fs.readFileSync("config.json"));
const CANVAS_API_KEY = constants["CANVAS_API_KEY"];
const CANVAS_HOST = constants["CANVAS_HOST"];
const PRIVATE_KEY = constants["PRIVATE_KEY"];
const GOOGLE_SPREADSHEET_ID = constants["GOOGLE_SPREADSHEET_ID"];

function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * An http request handler for Canvas, implemented with help from
 * https://flaviocopes.com/node-http-post/
 * 
 * @param {string} path Relative path for canvas request
 * @param {int} port Port to use
 * @param {string} method GET/POST/PUT
 * @param {string} body Body data to post 
 * @param {string} bodyheaders Body headers
 * @param {function} nextstep A function to execute on the response object once this request is complete
 */
function httprequestCanvas(path="/", port=443, method="POST", body="", bodyheaders={}, nextstep=null) {

    body = JSON.stringify(body)

    var reqheaders = {}

    if(body.length > 0) {
        reqheaders['Content-Type'] = 'application/json';
        reqheaders['Content-Length'] = body.length;    
    }

    for(var key in bodyheaders) {
        reqheaders[key] = bodyheaders[key]
    }

    const options = {
        hostname: CANVAS_HOST,
        port: port,
        path: path,
        method: method,
        headers: reqheaders
    }

    var resp = "";

    const req = https.request(options, (res) => {
        console.log(`statusCode: ${res.statusCode}`)

        res.on('data', (d) => {
            resp += d.toString();
        })

        res.on('end', () => {
            var respobj = JSON.parse(resp);
            //process.stdout.write(resp);
            //console.log(res.headers);
            if(nextstep) {
                nextstep(respobj);
            }
        })
    });

    req.on('error', (error) => {
        console.error(error);
    })

    if(body.length > 0) {
        req.write(body);
    }

    req.end();
}


/**
 * Return an object that converts from netid => canvasid
 * @param {string} courseId ID of course from which to grab roster
 * @returns {netid : canvasid}
 */
function getCanvasRosterConversions(courseId) {
    return new Promise(resolve => {
      httprequestCanvas(
        "/api/v1/courses/"+courseId+"/enrollments?per_page=100&include[]=email", 443, "GET", "", {"Authorization": "Bearer " + CANVAS_API_KEY}, 
        function(resp){
          let netid2id = {};
          for (let i = 0; i < resp.length; i++) {
            if (!(resp[i].user.email === null)) {
              netid2id[resp[i].user.email.split("@")[0]] = resp[i].user.id;
            }
          }
          resolve(netid2id);
        }
      );      
    })
  }


/**
 * 
 * @param {string} payload A base64 encoded payload
 * @param {string} privateKey Private key string
 */
async function decryptData(payload, privateKey) {
    let data = JSON.parse(Buffer.from(payload, 'base64').toString());

    // Step 1: Decrypt aes key using RSA key
    const rsaDecrypt = new JSEncrypt();
    rsaDecrypt.setPrivateKey(privateKey);
    let aesKey = base64ToArrayBuffer(rsaDecrypt.decrypt(data.aesKey));

    aesKey = await crypto.subtle.importKey(
        "raw", 
        aesKey,
        {
            name: 'AES-CBC',
            length: 256,
        },
        true,
        ['encrypt', 'decrypt']
    );

    // Step 2: Decrypt files using AES key
    for (let i = 0; i < data.files.length; i++) {
        let file = await crypto.subtle.decrypt(
            {
                name: 'AES-CBC',
                iv: base64ToArrayBuffer(data.iv),
            },
            aesKey,
            base64ToArrayBuffer(data.files[i].content)
        );
    
        let decoder = new TextDecoder();
        data.files[i].content = decoder.decode(file);
    }

    // Step 3: Decrypt the username using AES key
    let user = await crypto.subtle.decrypt(
        {
            name: 'AES-CBC',
            iv: base64ToArrayBuffer(data.iv),
        },
        aesKey,
        base64ToArrayBuffer(data.user)
    );
    let decoder = new TextDecoder();
    data.user = decoder.decode(user);

    return data;
}

/**
 * Post a submission from a particular payload to canvas
 * @param {object} data Unencrypted payload sent down from a module
 * @returns true if successful, false otherwise
 */
async function processResponse(data) {   
    let success = false;
    // Post to canvas
    if (!('courseId' in data)) {
        console.log("Warning: Requesting canvas post, but courseId field was not supplied");
        return false;
    }
    if (!('asmtId' in data)) {
        console.log("Warning: Requesting canvas post, but asmtId field was not supplied");
        return false;
    }
    if (!('points' in data)) {
        console.log("Warning: Requesting canvas post, but points field was not supplied");
        return false;
    }

    // Step 1: Unpack all of the metadata needed to make this post
    const netid = data['user'].toLowerCase();
    const points = parseFloat(data['points']);
    if ("halfcredit" in data && data.halfcredit) {
        points = points/2;
    }
    // NOTE: Assuming assignment IDs are specified in parallel to course IDs
    // for multiple sections
    const courseIds = data['courseId'].split(",");
    const asmtIds = data['asmtId'].split(",");

    // Step 2: Look through all sections to obtain canvas user id from course id and netid
    let userFound = false;
    let userId = -1;
    let courseId = -1;
    let asmtId = -1;
    for (let i = 0; i < courseIds.length; i++) {
        let netid2id = await getCanvasRosterConversions(courseIds[i]);
        if (netid in netid2id) {
            userFound = true;
            userId = netid2id[netid];
            courseId = courseIds[i];
            asmtId = asmtIds[i];
        }
    }
    
    // Step 3: Make canvas requests
    if (!userFound) {
        console.log("Warning: Student not found in canvas mapping " + netid + " in courses " + courseId);
        return false;
    }
    try {
        // Step 2a: Post score to canvas
        let gradeurl = "/api/v1/courses/"+courseId+"/assignments/"+asmtId+"/submissions/update_grades?grade_data["+userId+"][posted_grade]="+points;
        console.log("Posting assignment " + asmtId + " to canvas for student " + netid + " (" + userId + ") at " + gradeurl);
        await new Promise(resolve => {
            httprequestCanvas(gradeurl, 443, "POST", {}, {"Authorization": "Bearer " + CANVAS_API_KEY}, function(response) {
                console.log(response);
                resolve();
            });
        })

        sleep.sleep(5);

        // Step 2b: Clear missing status
        let missingurl = "/api/v1/courses/"+courseId+"/assignments/"+asmtId+"/submissions/"+userId;
        console.log("Clearing missing status, if any: " + missingurl);
        let missingbody = { "submission": { "late_policy_status": "none", "missing": false, "workflow_state": "submitted", "read_status": "read" } }; 
        await new Promise(resolve => {
            httprequestCanvas(missingurl, 443, "PUT", missingbody, {"Authorization": "Bearer " + CANVAS_API_KEY}, function(response) {
                console.log(response);
                resolve();
            });
        })
        success = true;
    } catch(err) {
        console.log("Error Posting to Canvas: " + err.message);
        success = false;
    }

    return success;
}

/**
 * Repeatedly download the csv file from the google spreadsheet and 
 * post any new submissions that come through
 */
async function pollGoogleForm() {
    while (true) {
        await exec("curl -k -L 'https://docs.google.com/spreadsheets/d/" + GOOGLE_SPREADSHEET_ID + "/export?exportFormat=csv' -o responses.csv");
        let rows = fs.readFileSync("responses.csv").toString().split("\n");
        let responses = [];
        let fields = rows[0].split(",").filter(s => s.trim());
        let magicIdx = 1;
        let payloadIdx = 2;
        if (fields[2].substring(0, 5) == "magic") {
            magicIdx = 2;
            payloadIdx = 1;
        }
        for (let i = 1; i < rows.length; i++) {
            let fields = rows[i].split(",").filter(s => s.trim());
            if (fields.length == 3 && fields[magicIdx].substring(0, 5) == "magic") {
                responses.push({"date":fields[0], "payload":fields[payloadIdx]});
            }
        }
    
        // Step 1: Find the first response that we haven't processed yet
        let startIdx = 0;
        try {
            let lastDate = fs.readFileSync("lastDate.txt").toString().trim();
            if (lastDate.length > 0) {
                let foundStart = false;
                while (startIdx < responses.length && !foundStart) {
                    responses[startIdx].date = responses[startIdx].date.trim();
                    if (responses[startIdx].date == lastDate) {
                        foundStart = true;
                    }
                    startIdx++;
                }
            }
        }
        catch(err) {
            if (!(err.code === 'ENOENT')) {
                console.log(err);
            }
        }

    
        // Step 2: Loop through and process each response
        for (let i = startIdx; i < responses.length; i++) {
            let success = false;
            try {
                let data = await decryptData(responses[i].payload, PRIVATE_KEY);
                success = await processResponse(data);
            }
            catch (exception) {
                console.log("Failure on", responses[i].date);
                console.log(exception);
            }
            // Append this to "allData.txt" no matter what just in case there's a problem
            // and we need to go back
            responses[i].success = success;
            fs.appendFileSync("allData.txt", JSON.stringify(responses[i]) + "\n");
        }
        lastDate = responses[responses.length-1].date;
        fs.writeFileSync("lastDate.txt", lastDate);

        
        // Step 3: Wait a minute to try again
        sleep.sleep(60);
    }
}

pollGoogleForm();