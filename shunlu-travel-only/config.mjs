import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';

function envFile(path){try{return parseEnv(readFileSync(new URL(path,import.meta.url),'utf8'))}catch(e){if(e.code==='ENOENT')return {};throw e}}
// Read FlyAI credentials from the local server configuration.
const shared=envFile('.env');
for(const k of ['FLYAI_API_KEY','FLYAI_NODE_BIN'])if(shared[k]?.trim())process.env[k]=shared[k].trim();
export function guideSetting(name,fallback=''){
 return (envFile('.env')[name]??process.env[name]??fallback).trim();
}
export function aiConfig(){
 const local=envFile('.env');
 const value=(name,fallback='')=>(local[name]??process.env[name]??fallback).trim();
 const key=value('DASHSCOPE_API_KEY');
 const base=value('STAYPLAY_AI_BASE_URL','https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/,'');
 let url;try{url=new URL(base)}catch{throw Error('模型 API 地址格式不正确，请检查 .env 的 STAYPLAY_AI_BASE_URL')}
 // Restrict secret transmission to the documented Aliyun endpoints.
 const allowed=url.hostname==='dashscope.aliyuncs.com'||url.hostname==='dashscope-intl.aliyuncs.com'||url.hostname==='dashscope-us.aliyuncs.com'||/^[a-zA-Z0-9-]+\.[a-z0-9-]+\.maas\.aliyuncs\.com$/.test(url.hostname);
 if(url.protocol!=='https:'||!allowed||url.username||url.password||url.port||url.search||url.hash||!['/compatible-mode/v1','/v1'].includes(url.pathname))throw Error('请使用阿里云百炼官方兼容接口地址');
 return {key,base,model:value('STAYPLAY_MODEL','qwen3.7-flash')};
}
