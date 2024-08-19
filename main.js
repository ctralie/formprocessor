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
const CANVAS_STUDENTS = constants["CANVAS_STUDENTS"];
const CANVAS_NETIDS = constants["CANVAS_NETIDS"];
const PRIVATE_KEY = constants["PRIVATE_KEY"];

function printResp(resp) {
    console.log(resp);
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
 * 
 * @param {string} payload A base64 encoded payload
 * @param {string} privateKey Private key string
 */
async function decryptData(payload, privateKey) {
    let data = JSON.parse(Buffer.from(payload, 'base64').toString());

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
    return data;
}


async function processResponse(parsedjsonobj) {
    // TODO: Finish this
    let netid = parsedjsonobj['user'];
    netid = netid.toLowerCase();
    
    // Post to canvas
    let studentfound = false;
    
    
    if ('canvasasmtid' in parsedjsonobj) {
        let asmtid = parsedjsonobj['canvasasmtid'];
        asmtid = asmtid.split(',');
        let canvaspoints = 2.0;
        if ('canvaspoints' in parsedjsonobj) {
            canvaspoints = parseFloat(parsedjsonobj['canvaspoints']);
        }
        else {
            console.log("Warning: Requesting canvas post, but canvaspoints field was not supplied");
        }
        if ('canvashalfcredit' in parsedjsonobj) {
            canvaspoints = canvaspoints / 2;
        }
        asmtidx = -1;
        for (i = 0; i < CANVAS_STUDENTS.length; i++) { // for multiple sections
            let user_id = ''; // find netid in this section of enrollments, or empty if not found
            
            for(canvasuserid in CANVAS_STUDENTS[i]) {
                sisid = CANVAS_STUDENTS[i][canvasuserid];
                
                //console.log(sisid + " " + canvasuserid);
                for(sisidkey in CANVAS_NETIDS) {
                    //console.log("Checking " + sisidkey);
                    if(sisid === sisidkey && CANVAS_NETIDS[sisidkey] === netid) {
                        user_id = canvasuserid;
                        asmtidx = i;
                        //console.log("Found " + user_id);
                        break;
                    }
                }
                
                if(user_id.length > 0 && asmtidx >= 0) {
                    break;
                }
            }
            
            if (user_id.length > 0 && asmtidx >= 0) {
                studentfound = true;
                
                try {
                    let gradeurl = "/api/v1/courses/"+CANVAS_COURSE_ID[i]+"/assignments/" + asmtid[asmtidx] + "/submissions/update_grades?grade_data["+user_id+"][posted_grade]="+canvaspoints;
                    console.log("Posting assignment " + asmtid[asmtidx] + " to canvas for student " + netid + " (" + user_id + ") at " + gradeurl);
                    httprequestCanvas(gradeurl, 443, "POST", {}, {"Authorization": "Bearer " + CANVAS_API_KEY}, printResp);
    
                    sleep.sleep(5);
    
                    let missingurl = "/api/v1/courses/"+CANVAS_COURSE_ID[i]+"/assignments/" + asmtid[asmtidx] + "/submissions/" + user_id;
                    console.log("Clearing missing status, if any: " + missingurl);
                    let missingbody = { "submission": { "late_policy_status": "none", "missing": false, "workflow_state": "submitted", "read_status": "read" } }; 
                    httprequestCanvas(missingurl, 443, "PUT", missingbody, {"Authorization": "Bearer " + CANVAS_API_KEY}, printResp);
                } catch(err) {
                    console.log("Error Posting to Canvas: " + err.message);
                }
            } else {
                console.log("Warning: Student not found in canvas mapping " + netid + " in section " + i);
            }
        }
    }
    else {
        console.log("Warning: Requesting canvas post, but canvasasmtid field was not supplied");
    }
    
    res.end('ok (input below)\n\n' + unpackedjson);
}


async function pollGoogleForm() {
    while (true) {
        await exec('python html_parser.py'); // I had trouble getting this to work in Javascript so I used BeautifulSoup in python
        let responses = JSON.parse(fs.readFileSync("responses.json"));
    
        // Step 1: Find the first response that we haven't processed yet
        let lastDate = fs.readFileSync("lastDate.txt").toString();
        let startIdx = 0;
        let foundStart = false;
        while (startIdx < responses.length && !foundStart) {
            if (responses[startIdx].date == lastDate) {
                foundStart = true;
            }
            startIdx++;
        }
        if (foundStart) {
            // TODO: Update this to lastDate.txt
            fs.writeFileSync("yee.txt", responses[responses.length-1].date);
        }
    
        // Step 2: Loop through and process each response
        for (let i = startIdx; i < responses.length; i++) {
            let data = await decryptData(responses[i].payload, PRIVATE_KEY);
            console.log(responses[i].date, data);
            //processResponse(data);
        }
        
        // Step 3: Wait a minute to try again
        sleep.sleep(60);
    }
}

pollGoogleForm();