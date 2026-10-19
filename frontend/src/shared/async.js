async function safeResult(fn){try{return{ok:true,data:await fn()}}catch(error){return{ok:false,error}}}

  async function safe(fn,fallback){try{return await fn()}catch{return fallback}}
export { safeResult, safe };
