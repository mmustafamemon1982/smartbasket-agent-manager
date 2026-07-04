require("dotenv").config();
const { runAgentOnce } = require("../agent");

runAgentOnce()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
