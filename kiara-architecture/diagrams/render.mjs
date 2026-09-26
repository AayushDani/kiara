// Artifact rendering only. No application, provider or database calls.
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const directory=dirname(fileURLToPath(import.meta.url));
const files=['01-system-overview','02-event-approval-sequence','03-workflow-state-machine','03b-notification-state-machine','03c-review-state-machine','05-harness-adaptation','06-deployment-and-storage'];
const cli=process.env.MERMAID_CLI||'mmdc';
const config=process.env.MERMAID_PUPPETEER_CONFIG;
const version=spawnSync(cli,['--version'],{encoding:'utf8'});
if(version.status!==0)throw new Error('Install @mermaid-js/mermaid-cli and set MERMAID_CLI if needed.');
const artifacts=[];
for(const file of files){
  for(const extension of ['svg','png']){
    const source=join(directory,`${file}.mmd`),output=join(directory,`${file}.${extension}`);
    const args=['-i',source,'-o',output,'-c',join(directory,'mermaid-config.json'),'-b','white','-w','1800','-s','1.5'];
    if(config)args.push('-p',config);
    const result=spawnSync(cli,args,{stdio:'inherit'});
    if(result.status!==0)throw new Error(`Rendering failed: ${file}.${extension}`);
    artifacts.push({file:`${file}.${extension}`,source_sha256:createHash('sha256').update(readFileSync(source)).digest('hex'),output_sha256:createHash('sha256').update(readFileSync(output)).digest('hex')});
  }
}
writeFileSync(join(directory,'render-manifest.json'),JSON.stringify({implementation_revision:'74823e4',renderer:'@mermaid-js/mermaid-cli',renderer_version:version.stdout.trim(),artifacts},null,2)+'\n');
console.log(`Rendered ${artifacts.length} architecture artifacts.`);
