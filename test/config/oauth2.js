/*global process:true */
module.exports = {
  authzServiceUrl : "https://login.salesforce.com/services/oauth2/authorize",
  tokenServiceUrl : "https://login.salesforce.com/services/oauth2/token",
  clientId :        process.env.SF_OAUTH2_CLIENT_ID,
  clientSecret :    process.env.SF_OAUTH2_CLIENT_SECRET,
  redirectUri :     "http://localhost:4000/oauth2/callback",
  username :        process.env.SF_USERNAME,
  password :        process.env.SF_PASSWORD
};
