import type {NextConfig} from 'next';
import {withWorkflow} from 'workflow/next';

const config:NextConfig={
  outputFileTracingIncludes:{
    '/*':['./kiara-architecture/fixtures/**/*','./src/adaptation/*.ts','./src/runtime/*.ts','./src/workflow/*.ts','./src/validation/*.ts'],
  },
  outputFileTracingExcludes:{'/*':['./.env*','./.kiara/**/*','./research/**/*','./build-coordination/**/*','./.git/**/*']},
  async headers(){return [{source:'/(.*)',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Referrer-Policy',value:'same-origin'},
  ]}];},
};
export default withWorkflow(config);
