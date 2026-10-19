function downloadBlob(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},100)}

  function downloadText(name,text){downloadBlob(name,new Blob([text],{type:'text/plain;charset=utf-8'}))}
export { downloadBlob, downloadText };
