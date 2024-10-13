## Getting Started

1) Go to [https://docs.google.com/forms/](https://docs.google.com/forms/)
Make a google form with the fields "magic" (short answer) and "payload" (paragraph)  
2) Go to Settings->responses and turn off requiring sign in  
3) Get a prefilled link, ensure magic is set to magic and payload is empty, change the end of the URL you are given by the pre-filled link to
`formResponse?submit=Submit`  
4) Under responses, click the option to obtain a link to sheets   
5) Change spreadsheet sharing so that anyone with a link can be a viewer  
6) Take note of the spreadsheet ID, put in config file for backend  


## Running main.js

`curl` is required, as well as `node` and `npm`

To get started, type:
~~~~~ bash
npm install .
~~~~~

Then, create a file <code>config.json</code> with the following constants set:

* `CANVAS_API_KEY` - your Canvas API key for posting grades to your LMS from the student submissions on the Google spreadsheet
* `CANVAS_HOST` - the URL of your Canvas LMS (i.e., `your-institution.instructure.com`
* `PRIVATE_KEY` - the private key that goes with your RSA public key that you set on the WebIDE for encrypting/decrypting student submissions to the Google spreadsheet
* `GOOGLE_SPREADSHEET_ID` - your Google spreadsheet ID noted from above  

