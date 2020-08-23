// https://itnext.io/how-to-handle-the-post-request-body-in-node-js-without-using-a-framework-cd2038b93190
// https://www.w3schools.com/nodejs/nodejs_email.asp
// SendGrid:
//     https://app.sendgrid.com/guide/integrate/langs/nodejs
//     npm install --save @sendgrid/mail 
//     API Key in SENDGRID_API_KEY environment variable

// Setup dependencies
const https = require('https');
const http = require('http');
const fs = require('fs');
const { parse } = require('querystring');
const sgMail = require('@sendgrid/mail');


// Load in constants
const constants = JSON.parse(fs.readFileSync(process.env.COURSEWD + "config.json"));
sgMail.setApiKey(constants["SENDGRID_API_KEY"]);
const FORMPROCESSOR_PORT = constants["FORMPROCESSOR_PORT"];
const FORMPROCESSOR_USE_HTTPS = constants["FORMPROCESSOR_USE_HTTPS"];
const FORMPROCESSOR_POST_TO_CANVAS = constants["FORMPROCESSOR_POST_TO_CANVAS"];;
const CANVAS_API_KEY = constants["CANVAS_API_KEY"];
const CANVAS_COURSE_ID = constants["CANVAS_COURSE_ID"];
const CANVAS_HOST = constants["CANVAS_HOST"];
const CANVAS_STUDENTS = constants["CANVAS_STUDENTS"];


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
                        let logprint = "Message sent to " + msg.to;
                        if ('cc' in msg) {
                            logprint += " and CCed to " + msg['cc'];
                        }
                        console.log(logprint);
                    }).catch((error) => {
                            console.log(error.response.body);
                    });
                    // Post to canvas
                    if (FORMPROCESSOR_POST_TO_CANVAS) {
                        if ('canvasasmtid' in parsedjsonobj) {
                            let asmtid = parsedjsonobj['canvasasmtid'];
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
                            if (netid in CANVAS_STUDENTS) {
                                let user_id = CANVAS_STUDENTS[netid];
                                httprequestCanvas("/api/v1/courses/"+CANVAS_COURSE_ID+"/assignments/" + asmtid + "/submissions/update_grades?grade_data["+user_id+"][posted_grade]="+canvaspoints, 443, "POST", {}, {"Authorization": "Bearer " + CANVAS_API_KEY}, printResp);
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
