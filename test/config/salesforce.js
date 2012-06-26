module.exports = {
  loginServerUrl : "https://login.salesforce.com",
  username :       process.env.SF_USERNAME,
  password :       process.env.SF_PASSWORD,
  clientId :       process.env.SF_OAUTH2_CLIENT_ID,
  clientSecret :   process.env.SF_OAUTH2_CLIENT_SECRET,
  redirectUri :    "http://localhost:4000/oauth2/callback",
  bigTable :       "BigTable__c",
  upsertTable :    "UpsertTable__c",
  upsertField :    "ExtId__c"
};
