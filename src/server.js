const path = require('node:path');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
const app = createApp({ staticDir: path.join(__dirname, '..', 'public') });

app.createServer().listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`QRipple server listening on http://localhost:${port}`);
});
