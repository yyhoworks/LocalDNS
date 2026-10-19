import { clientsService } from './clients.js';
export let clientAliases = {};
import { api } from '../../core/api/api.js';
import { modalOpen } from '../../shared/components/dialog.js';
import { toast } from '../../shared/components/toast.js';
import { renderRoute } from '../../core/router/router.js';
import { currentScope } from '../../core/router/route-lifetime';

  async function loadAliases(scope=currentScope()){try{clientAliases=await scope.guard(api.request('/plugins/client_name'))||{}}catch(error){if(scope.signal.aborted)throw error;clientAliases={}}scope.add(()=>{clientAliases={}});return clientAliases;}

  async function openAliasModal(){
    const scope=currentScope();
    try {
      await clientsService.open({
        request:(...args)=>api.request(...args), rank:(...args)=>api.rank(...args),
        modal:modalOpen, notify:toast,
        onSaved:next=>{if(scope.signal.aborted)return;clientAliases=next;renderRoute(true);}
      });
    } catch(error) { if(scope.signal.aborted)return;toast('客户端管理读取失败','error',error.message); }
  }
export { loadAliases, openAliasModal };
