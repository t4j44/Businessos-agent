// Local UI fixture for the real widget. All API responses are simulated in the
// page; it never contacts Supabase, an AI provider, or a business.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const widget = fs.readFileSync(path.resolve(__dirname, '../public/widget/widget.js'));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local widget interaction test</title><body style="font-family:system-ui;padding:24px;background:#f4f4f5;color:#18181b">
<h1>Local widget interaction test</h1><p>Simulated API responses. No business or provider is contacted.</p>
<p id="fixture-status">Requests saved: 0</p>
<script>
let requests=0;
window.fetch=async function(url,options){
  const pathname=new URL(url,location.origin).pathname;
  if(pathname==='/api/widget/config') return Response.json({company_name:'Demo business',brand_color_primary:'#2563eb',welcome_message:'This is a local test of the website assistant.'});
  if(pathname==='/api/widget/handoff'){
    const body=JSON.parse(options.body);
    if(!body.request_key||!body.session_id||!body.reason||(!body.email&&!body.phone))return Response.json({error:'Invalid fixture payload'},{status:400});
    requests++;document.getElementById('fixture-status').textContent='Requests saved: '+requests;
    return Response.json({saved:true,status:'requested',notification_sent:false,message:'Local test request saved. No business was contacted.'});
  }
  if(pathname==='/api/widget/chat')return Response.json({error:'Your request is waiting in the team’s inbox. AI replies are paused.'},{status:409});
  throw new Error('External requests are disabled in this fixture.');
};
</script><script src="/widget/widget.js" data-client-id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"></script></body></html>`;
http.createServer((req,res)=>{
  if(req.url==='/widget/widget.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(widget);return;}
  if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  res.writeHead(404);res.end();
}).listen(3188,'127.0.0.1',()=>process.stdout.write('Widget fixture: http://127.0.0.1:3188 (simulated APIs only)\n'));
