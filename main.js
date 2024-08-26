const https = require('https');
const fs = require('fs-extra');
const JSEncrypt = require('node-jsencrypt');
const crypto = require('crypto');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const JSZip = require('jszip');
const path = require('path');
const FormData = require('form-data');
const url = require('url');

// Load in constants
const constants = JSON.parse(fs.readFileSync("config.json"));
const CANVAS_API_KEY = constants["CANVAS_API_KEY"];
const CANVAS_HOST = constants["CANVAS_HOST"];
const PRIVATE_KEY = constants["PRIVATE_KEY"];
const GOOGLE_SPREADSHEET_ID = constants["GOOGLE_SPREADSHEET_ID"];

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
    if(!('Content-Type' in bodyheaders)) {
        body = JSON.stringify(body)
    }

    var reqheaders = {}

    if(body.length > 0 && !('Content-Type' in bodyheaders) && !('Content-Length' in bodyheaders)) {
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
    
    console.log(`Making HTTP request: ${JSON.stringify(options)}"`);

    var resp = "";

    const req = https.request(options, (res) => {
        console.log(`statusCode: ${res.statusCode}`);

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

function base64ToBuffer(base64) {
    return Buffer.from(base64, 'base64');
}

/**
 * Creates a ZIP file from the provided data object.
 *
 * @param {Object} data - The data object containing files information.
 * @param {Array} data.files - An array of file objects.
 * @param {string} data.files[].name - The relative path and name of the file within the ZIP.
 * @param {string|Buffer} data.files[].content - The content of the file.
 * @param {string} outputPath - The path where the ZIP file will be saved.
 * @returns {string} - The base64 encoded zip file
 */
async function zipPayloadFiles(data) {
    try {
        if (!data || !Array.isArray(data.files)) {
            throw new Error('Invalid data format. Expected an object with a files array.');
        }

        const zip = new JSZip();

        data.files.forEach(file => {
            if (!file.name || file.content === undefined) {
                throw new Error('Each file must have a name and content.');
            }
            zip.file(file.name, file.content);
        });
        
        const zipContent = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

        return zipContent.toString('base64');
    } catch (error) {
        console.error('Error creating ZIP file:', error.message);
        throw error;
    }
}

/**
 * 
 * @param {string} payload A base64 encoded payload
 * @param {string} privateKey Private key string
 */
async function decryptData(payload, privateKey) {
    let data = JSON.parse(base64ToBuffer(payload).toString());

    // Step 1: Decrypt AES key using RSA key
    const rsaDecrypt = new JSEncrypt();
    rsaDecrypt.setPrivateKey(privateKey);
    let aesKeyBuffer = base64ToBuffer(rsaDecrypt.decrypt(data.aesKey));

    // Step 2: Decrypt files using AES key
    for (let i = 0; i < data.files.length; i++) {
        let fileBuffer = base64ToBuffer(data.files[i].content);
        let ivBuffer = base64ToBuffer(data.iv);

        let decipher = crypto.createDecipheriv('aes-256-cbc', aesKeyBuffer, ivBuffer);
        let decrypted = Buffer.concat([
            decipher.update(fileBuffer),
            decipher.final()
        ]);

        data.files[i].content = decrypted.toString('utf-8');
    }

    // Step 3: Decrypt the username using AES key
    let userBuffer = base64ToBuffer(data.user);
    let ivBuffer = base64ToBuffer(data.iv);

    let decipher = crypto.createDecipheriv('aes-256-cbc', aesKeyBuffer, ivBuffer);
    let decryptedUser = Buffer.concat([
        decipher.update(userBuffer),
        decipher.final()
    ]);

    data.user = decryptedUser.toString('utf-8');

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
        // Step 3a: Post score to canvas
        let gradeurl = "/api/v1/courses/"+courseId+"/assignments/"+asmtId+"/submissions/update_grades?grade_data["+userId+"][posted_grade]="+points;
        console.log("Posting assignment " + asmtId + " to canvas for student " + netid + " (" + userId + ") at " + gradeurl);
        await new Promise(resolve => {
            httprequestCanvas(gradeurl, 443, "POST", {}, {"Authorization": "Bearer " + CANVAS_API_KEY}, function(response) {
                console.log(response);
                resolve();
            });
        })

        await sleep(5000);
        
        // Step 3b: Upload the student submission to our files section, and link it to the student's submission
        console.log("Requesting upload URL to course files section");
        
        let uploadurl = "/api/v1/courses/" + courseId + "/assignments/" + asmtId + "/submissions/" + userId + "/comments/files";
        let zipFileContentsBase64 = await zipPayloadFiles(data); 
        let zipFileName = "exercise-" + asmtId + "-" + userId + ".zip";

        const form = new FormData();
        form.append('name', zipFileName);
        form.append('content_type', 'application/zip');

        const uploadResponse = await new Promise(resolve => {
            httprequestCanvas(uploadurl, 443, "POST", form, {"Authorization": "Bearer " + CANVAS_API_KEY, ...form.getHeaders(), 'Content-Type': 'multipart/form-data'}, function(response) {
                console.log(response);
                resolve(response);
            });
        });

        const { upload_url, upload_params } = uploadResponse;

        console.log("Uploading zip file to course files section");
        
        let parsedUrl = url.parse(upload_url);
        let zipFileContents = Buffer.from(zipFileContentsBase64, 'base64');
        
        const zipUploadForm = new FormData();
        zipUploadForm.append('file', zipFileContents, {
            filename: zipFileName,
            contentType: 'application/zip'
        });
        
        let uploadOptions = {}
        uploadOptions['headers'] = zipUploadForm.getHeaders();
    
        for(var key in upload_params) {
            uploadOptions['headers'][key] = upload_params[key];
        }        
        
        uploadOptions['hostname'] = parsedUrl.hostname;
        uploadOptions['port'] = parsedUrl.port || 443;
        uploadOptions['path'] = parsedUrl.path;
        uploadOptions['method'] = "POST";
        uploadOptions['headers']['filename'] = zipFileName;
        uploadOptions['headers']['Authorization'] = 'Bearer ' + CANVAS_API_KEY;

        const req = https.request(uploadOptions, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                console.log('Upload Response:', responseData);
                
                let responseDataJson = JSON.parse(responseData);
                
                let uploadFileId = responseDataJson.id;
                
                // Step 3c: Clear missing status and attach comment
                console.log("Clearing missing status, if any, and attaching submission comment");
                
                let missingurl = "/api/v1/courses/"+courseId+"/assignments/"+asmtId+"/submissions/"+userId;
                let missingbody = { "submission": { "late_policy_status": "none", "missing": false, "workflow_state": "submitted", "read_status": "read"}, "comment": { "file_ids": [uploadFileId] } }; 
                httprequestCanvas(missingurl, 443, "PUT", missingbody, {"Authorization": "Bearer " + CANVAS_API_KEY}, function(response) {
                    console.log(response);
                });
            });
        });

        req.on('error', (error) => {
            console.error('Error during file upload:', error.message);
            success = false;
        });
        
        zipUploadForm.pipe(req);
        
        req.end();

        await sleep(5000);
                
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
            let user = "";
            let data = null;
            try {
                data = await decryptData(responses[i].payload, PRIVATE_KEY);
            }
            catch (exception) {
                console.log("Error decrypting data!  (Check your public/private key pairs?");
                console.log(exception);
            }
            try{
                success = await processResponse(data);
                user = data.user;
            }
            catch (exception) {
                console.log("Error processing response!");
                console.log(exception);
            }

            if (success) {
                console.log("Success for", user, "on", responses[i].date, "!");
            }
            else {
                console.log("Failure on", responses[i].date);
            }
            // Append this to "allData.txt" no matter what just in case there's a problem
            // and we need to go back
            responses[i].success = success;
            fs.appendFileSync("allData.txt", JSON.stringify(responses[i]) + "\n");
        }
        if (responses.length > 0) {
            lastDate = responses[responses.length-1].date;
            fs.writeFileSync("lastDate.txt", lastDate);
        }

        
        // Step 3: Wait a minute to try again
        await sleep(60000);
    }
}

pollGoogleForm();
