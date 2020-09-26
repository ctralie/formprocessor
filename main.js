// https://itnext.io/how-to-handle-the-post-request-body-in-node-js-without-using-a-framework-cd2038b93190
// https://www.w3schools.com/nodejs/nodejs_email.asp
// SendGrid:
//     https://app.sendgrid.com/guide/integrate/langs/nodejs
//     npm install --save @sendgrid/mail 
//     API Key in SENDGRID_API_KEY config.json variable
// SocketLabs:
//     https://www.socketlabs.com/send-email-nodejs/
//     API Key in SOCKETLABS_API_KEY config.json variable
// MailJet:
//     API Key in MAILJET_API_KEY config.json variable
//     https://app.mailjet.com/auth/get_started/developer
//     npm install node-mailjet

// Setup dependencies
const https = require('https');
const http = require('http');
const fs = require('fs');
const { parse } = require('querystring');

// Load in constants
const constants = JSON.parse(fs.readFileSync(process.env.COURSEWD + "config.json"));
const FORMPROCESSOR_PORT = constants["FORMPROCESSOR_PORT"];
const FORMPROCESSOR_USE_HTTPS = constants["FORMPROCESSOR_USE_HTTPS"];
const FORMPROCESSOR_POST_TO_CANVAS = constants["FORMPROCESSOR_POST_TO_CANVAS"];;
const CANVAS_API_KEY = constants["CANVAS_API_KEY"];
const CANVAS_COURSE_ID = constants["CANVAS_COURSE_ID"];
const CANVAS_HOST = constants["CANVAS_HOST"];
const CANVAS_STUDENTS = constants["CANVAS_STUDENTS"];
const CANVAS_NETIDS = constants["CANVAS_NETIDS"];

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
    const https = require('https')

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
        req.write(JSON.stringify(body));
    }

    req.end();
}

function sendSgMail(parsedjsonobj, facultyemail, title, unpackedjson) {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(constants["SENDGRID_API_KEY"]);

    let msg = {};
    // If half credit, only e-mail the faculty member
    if ('canvashalfcredit' in parsedjsonobj) {
        msg = {
            to: facultyemail,
            from: facultyemail,
            subject: title + ': Form Processor Submission (Half Credit)',
            text: unpackedjson,
            html: unpackedjson
        };  
    }
    // Otherwise, e-mail the student and the faculty member
    else {
        msg = {
            to: studentemail,
            cc: facultyemail,
            from: facultyemail,
            subject: title + ': Form Processor Submission',
            text: unpackedjson,
            html: unpackedjson
        };                    
    }

    // Send email
    sgMail.send(msg).then(() => {
        let logprint = "Message sent via SendGrid to " + msg.to;
        if ('cc' in msg) {
            logprint += " and CCed to " + msg['cc'];
        }
        console.log(logprint);
    }).catch((error) => {
            console.log(error.response.body);
    });    
}

function sendSocketLabsMail(parsedjsonobj, facultyemail, title, unpackedjson) {
    const {SocketLabsClient} = require('@socketlabs/email');

    const client = new SocketLabsClient(parseInt(constants["SOCKETLABS_API_KEY"].server_id), constants["SOCKETLABS_API_KEY"].key);

    let message = {};
    
    // If half credit, only e-mail the faculty member
    if ('canvashalfcredit' in parsedjsonobj) {
        message = {
            to: facultyemail,
            from: facultyemail,
            subject: title + ': Form Processor Submission (Half Credit)',
            textBody: unpackedjson,
            htmlBody: unpackedjson,
            messageType: 'basic'
        }
    } 
    // Otherwise, e-mail the student and the faculty member
    else {
        message = {
            to: studentemail,
            from: facultyemail,
            cc: facultyemail,
            subject: title + ': Form Processor Submission',
            textBody: unpackedjson,
            htmlBody: unpackedjson,
            messageType: 'basic'
        }        
    }

    client.send(message); 

    let logprint = "Message sent via SocketLabs to " + msg.to;
    if ('cc' in msg) {
        logprint += " and CCed to " + msg['cc'];
    }
    console.log(logprint);    
}

function sendMailJetMail(parsedjsonobj, facultyemail, title, unpackedjson) {
    const mailjet = require('node-mailjet').connect(constants["MAILJET_API_KEY"].key, constants["MAILJET_API_KEY"].secret);
       
    // If half credit, only e-mail the faculty member
    if ('canvashalfcredit' in parsedjsonobj) {
        const request = mailjet
            .post("send", {'version': 'v3.1'})
            .request({
              "Messages":[
                {
                  "From": {
                    "Email": facultyemail,
                    "Name": facultyemail
                  },
                  "To": [
                    {
                      "Email": facultyemail,
                      "Name": facultyemail
                    }
                  ],             
                  "Subject": title + ': Form Processor Submission (Half Credit)',
                  "TextPart": unpackedjson,
                  "HTMLPart": unpackedjson
                }
              ]
            })
        request
          .then((result) => {
            let logprint = "Message sent via MailJet to " + facultyemail;
            console.log(logprint);
            console.log(result.body);
          })
          .catch((err) => {
            console.log(err.statusCode)
          }) 
    } 
    // Otherwise, e-mail the student and the faculty member
    else {
        const request = mailjet
            .post("send", {'version': 'v3.1'})
            .request({
              "Messages":[
                {
                  "From": {
                    "Email": facultyemail,
                    "Name": facultyemail
                  },
                  "To": [
                    {
                      "Email": studentemail,
                      "Name": studentemail
                    }
                  ],
                  "Cc": [
                    {
                      "Email": facultyemail,
                      "Name": facultyemail
                    }
                  ],               
                  "Subject": title + ': Form Processor Submission',
                  "TextPart": unpackedjson,
                  "HTMLPart": unpackedjson
                }
              ]
            })
        request
          .then((result) => {
            let logprint = "Message sent via MailJet to " + studentemail;
            logprint += " and CCed to " + facultyemail;
            console.log(logprint);
            console.log(result.body);
          })
          .catch((err) => {
            console.log(err.statusCode)
          })       
    }  
}

let httpsOptions = {
    key: fs.readFileSync('keys/mathcs-ursinus/mathcs.ursinus.key'),
     cert: fs.readFileSync('keys/mathcs-ursinus/mathcs-ursinus-cert.cer'),
    ca: [
        fs.readFileSync('keys/mathcs-ursinus/mathcs-ursinus-cert.cer'),      
        fs.readFileSync('keys/mathcs-ursinus/mathcs-ursinus-intermediates.cer'),
        fs.readFileSync('keys/mathcs-ursinus/mathcs-ursinus-bundle.cer')
    ],
    ciphers: [
        "ECDHE-RSA-AES128-SHA256",
        "DHE-RSA-AES128-SHA256",
        "AES128-GCM-SHA256",
        "RC4",
        "HIGH",
        "!MD5",
        "!aNULL"
        ].join(':'),
};

const serverHandler = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if(req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            const parsedjsonobj = parse(body)
            console.log(parsedjsonobj);

            let unpackedjson = '';
            for(var key in parsedjsonobj) {
                unpackedjson += "*** " + key + " ***<br>" + parsedjsonobj[key] + "<br><br>";
            }

            unpackedjson = unpackedjson.replace(/\r\n/g, '\n');
            unpackedjson = unpackedjson.replace(/\r/g, '\n');
            unpackedjson = unpackedjson.replace(/\n/g, '<br>');
            unpackedjson = unpackedjson.replace(/ /g, '&nbsp;');
            unpackedjson = unpackedjson.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');

            if(! ('facultyemail' in parsedjsonobj && 'studentnetid' in parsedjsonobj && 'title' in parsedjsonobj)) {
                res.end('fail (required form keys: facultyemail, studentnetid, title)');
            } else {
                if(!('magic' in parsedjsonobj) || (parsedjsonobj['magic'] != 'ursinus')) {
                    res.end('fail (authentication)')
                } else {
                    let netid = parsedjsonobj['studentnetid'];
                    facultyemail = parsedjsonobj['facultyemail'];
                    studentemail = netid + "@ursinus.edu";
                    title = parsedjsonobj['title'];
                    
                    // Email
                    if("SENDGRID_API_KEY" in constants) {
                        sendSgMail(parsedjsonobj, facultyemail, title, unpackedjson);
                    } else if("SOCKETLABS_API_KEY" in constants) {
                        sendSocketLabsMail(parsedjsonobj, facultyemail, title, unpackedjson);
                    } else if("MAILJET_API_KEY" in constants) {
                        sendMailJetMail(parsedjsonobj, facultyemail, title, unpackedjson);
                    }
                    
                    // Log
                    console.log(studentemail + "|" + facultyemail + "|" + title + "|" + unpackedjson)
                    
                    // Post to canvas
                    if (FORMPROCESSOR_POST_TO_CANVAS) {
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
                                    let gradeurl = "/api/v1/courses/"+CANVAS_COURSE_ID[i]+"/assignments/" + asmtid[asmtidx] + "/submissions/update_grades?grade_data["+user_id+"][posted_grade]="+canvaspoints;
                                    console.log("Posting assignment " + asmtid[asmtidx] + " to canvas for student " + netid + " (" + user_id + ") at " + gradeurl);
                                    httprequestCanvas(gradeurl, 443, "POST", {}, {"Authorization": "Bearer " + CANVAS_API_KEY}, printResp);

                                    let missingurl = "/api/v1/courses/"+CANVAS_COURSE_ID[i]+"/assignments/" + asmtid[asmtidx] + "/submissions/" + user_id;
                                    console.log("Clearing missing status, if any: " + missingurl);
                                    let missingbody = "{ \"submission\": { \"late_policy_status\": \"none\" } }";
                                    httprequestCanvas(missingurl, 443, "PUT", missingbody, {"Authorization": "Bearer " + CANVAS_API_KEY}, printResp);
                                } else {
                                    console.log("Warning: Student not found in canvas mapping " + netid + " in section " + CANVAS_STUDENTS[i]);
				}
                            }

                        }
                        else {
                            console.log("Warning: Requesting canvas post, but canvasasmtid field was not supplied");
                        }
                    }

                    res.end('ok (input below)\n\n' + unpackedjson);
                }
            }
        });
    } else {
        res.end(`
            <!doctype html>
            <html>
            <body>
                Please submit a form via POST.
                <!--
                <form action="/" method="post">
                    Test: <input type="text" name="test" /><br />
                    Test2: <input type="text" name="test2" /></br />
                    <input type="submit" name="submit" value="Submit" />
                </form>
                -->
            </body>
            </html>
        `);
    } 
};

let server = null;
if (FORMPROCESSOR_USE_HTTPS) {
    server = https.createServer(httpsOptions, serverHandler);
}
else {
    server = http.createServer(serverHandler);
}

server.listen(FORMPROCESSOR_PORT);
