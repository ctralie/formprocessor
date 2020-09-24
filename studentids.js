/**
 * A file to pull the student IDs from a course specified in config.js, and
 * to add a dictionary "CANVAS_STUDENTS" of {netid:user_id} to the console.
 * The following fields are expected in config.js:
 *    CANVAS_COURSE_ID An array of ID's of your course (can be found in Canvas URL of course)
 *    CANVAS_API_KEY: Generate this at https://ursinus.instructure.com/profile/settings
 *    CANVAS_HOST: "ursinus.instructure.com"
 */

const fs = require('fs');
let constants = JSON.parse(fs.readFileSync("config.json"));
const COURSEID = constants['CANVAS_COURSE_ID'];
const APIKEY = constants['CANVAS_API_KEY'];
const CANVAS_HOST = constants["CANVAS_HOST"];


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

function printStudents(resp) {
  let students = resp;
  for (let student of students) {
    console.log('id: ', student['id'], ', user_id: ', student['user_id'], ', sis_user_id: ', student['sis_user_id']);
  }
  for (let key in students[0]) {
    console.log(key);
  }
}

/**
 * Create a dictionary of student user IDs from a dictionary of SIS IDs
 * 
 * @param {list} students A list of students returned by the canvas API
 */
function getStudentUserIDsDict(students) {
  students_user_id = {};
  for (let student of students) {
    let userid = student['user_id'];
    let sisid = student['sis_user_id'];
    let courseid = student['course_id'];
    
    students_user_id[userid] = sisid;
  }
  
  return students_user_id;
}

/**
 * Convert from {sis_id:netid} to {netid:user_id} and output to the console
 */
function makeStudentDict() {
    let canvas_students_lists = [];
    
    for (i = 0; i < COURSEID.length; i++) { // for multiple sections
      canvas_students_list = {};
      
      //console.log(COURSEID[i]);
      
      httprequestCanvas(
        "/api/v1/courses/"+COURSEID[i]+"/enrollments?per_page=100&include[]=email", 443, "GET", "", {"Authorization": "Bearer " + APIKEY}, 
        function(resp){
          //console.log(resp);
          let students_user_id = getStudentUserIDsDict(resp, COURSEID[i]);
          const CANVAS_STUDENTS = students_user_id;
          console.log(CANVAS_STUDENTS);
        }
      );      
    }
}

makeStudentDict();
