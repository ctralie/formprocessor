// https://itnext.io/how-to-handle-the-post-request-body-in-node-js-without-using-a-framework-cd2038b93190
// https://www.w3schools.com/nodejs/nodejs_email.asp
// SendGrid:
// 	https://app.sendgrid.com/guide/integrate/langs/nodejs
// 	npm install --save @sendgrid/mail 
// 	API Key in SENDGRID_API_KEY environment variable

const http = require('http');
const { parse } = require('querystring');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const server = http.createServer((req, res) => {
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

			if(! ('facultyemail' in parsedjsonobj && 'studentemail' in parsedjsonobj && 'title' in parsedjsonobj)) {
				res.end('fail (required form keys: facultyemail, studentemail, title)');
			} else {
				if(!('magic' in parsedjsonobj) || (parsedjsonobj['magic'] != 'ursinus')) {
					res.end('fail (authentication)')
				} else {
					facultyemail = parsedjsonobj['facultyemail'];
					studentemail = parsedjsonobj['studentemail'];
					title = parsedjsonobj['title'];

					const msg = {
						to: studentemail,
						cc: facultyemail,
						from: facultyemail,
						subject: title + ': Form Processor Submission',
						text: unpackedjson,
						html: unpackedjson
					};

					sgMail.send(msg).then(() => {
						console.log('Message sent')
					}).catch((error) => {
    						console.log(error.response.body)
					});

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
});


server.listen(parseInt(process.env.FORMPROCESSOR_PORT));
