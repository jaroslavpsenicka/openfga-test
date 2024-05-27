const express = require('express');
const dotenv = require('dotenv');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { OpenFgaClient } = require('@openfga/sdk');

dotenv.config();

const app = express();

mongoose.set('strictQuery', false);
mongoose.connect(process.env.DB_URL, (err) => console.log(err ? err : 'Connected to the database.'));

app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

function auth(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (token == null) return res.sendStatus(401)
  jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
    if (err) console.log(err)
    if (err) return res.sendStatus(403)
    req.user = user
    next()
  })
}

const Client = mongoose.model('Client', { name: String, ownedBy: String, partner: String });

const fgaClient = new OpenFgaClient({
  apiUrl: process.env.FGA_API_URL, // required, e.g. https://api.fga.example
  storeId: process.env.FGA_STORE_ID,
  authorizationModelId: process.env.FGA_MODEL_ID, // Optional, can be overridden per request
});

app.get('/auth', (req, res) => {
  const token = jwt.sign({ email: 'patrick@doe.com'}, process.env.TOKEN_SECRET, { expiresIn: '365d' });
  res.send(token);
})

app.post('/fga', async (req, res) => {
  await fgaClient.write({ writes: [{ user: "user:mary", relation: "editor", object: "client:6653047e4bf73797e87c7f11" }]});
  await fgaClient.write({ writes: [{ user: "user:mary", relation: "viewer", object: "client:6653047e4bf73797e87c7f11" }]});
  await fgaClient.write({ writes: [{ user: "user:patrick", relation: "viewer", object: "partner:doe.com" }]});
  res.send();
})

app.get('/fga', auth, async (req, res) => {
  const user = req.user.email.substr(0, req.user.email.indexOf('@'));
  const clients = await fgaClient.listObjects({ user: `user:${user}`, relation: "viewer", type: "client" });
  res.send(clients?.objects);
})

app.get('/clients', auth, async (req, res) => {
  const user = req.user.email.substr(0, req.user.email.indexOf('@'));
  const partnerIds = await fgaClient.listObjects({ user: `user:${user}`, relation: "viewer", type: "partner" })
    .then(res => res.objects.map(o => o.substr(o.indexOf(":")+1)))
  const viewerIds = await fgaClient.listObjects({ user: `user:${user}`, relation: "viewer", type: "client" })
    .then(res => res.objects.map(o => o.substr(o.indexOf(":")+1)))
  const editorIds = await fgaClient.listObjects({ user: `user:${user}`, relation: "editor", type: "client" })
    .then(res => res.objects.map(o => o.substr(o.indexOf(":")+1)))
  console.log('user:', user, 'partner ids:', partnerIds, 'viewer ids:', viewerIds, 'editor ids:', editorIds);

  const clients = await Client.find({ $or: [
    { ownedBy: req.user.email }, 
    { partner: { $in: partnerIds }}, 
    { _id: { $in: [...viewerIds, ...editorIds] }} 
  ]});

  res.send(clients.map(c => c.name));
})

app.post('/clients/:id', auth, async (req, res) => {
  const user = req.user.email.substr(0, req.user.email.indexOf('@'));
  const client = await Client.findById(req.params.id);
  const isEditor = await fgaClient.check({ user: `user:${user}`, relation: "editor", object: `client:${req.params.id}` })
  console.log('user:', user, 'id:', req.params.id, 'is owner:', client.ownedBy === req.user.email, 'is editor:', isEditor.allowed);
  if (client.ownedBy !== req.user.email && !isEditor.allowed) return res.sendStatus(403);
  
  client.name = req.body.name;
  await client.save();
  res.send(client);
})

const PORT = process.env.PORT || 4000;
app.listen(PORT, (err) => console.log(err ? err : `Listening on http://localhost:${PORT}`));

module.exports = app;