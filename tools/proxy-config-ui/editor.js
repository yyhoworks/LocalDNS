import {basicSetup} from 'codemirror';
import {EditorView, keymap, Decoration} from '@codemirror/view';
import {EditorState, Compartment, Prec} from '@codemirror/state';
import {indentWithTab} from '@codemirror/commands';
import {StreamLanguage, syntaxHighlighting, HighlightStyle, indentUnit} from '@codemirror/language';
import {json} from '@codemirror/lang-json';
import {yaml as yamlLanguage} from '@codemirror/legacy-modes/mode/yaml';
import {tags} from '@lezer/highlight';
import {setDiagnostics, lintGutter} from '@codemirror/lint';
import {openSearchPanel} from '@codemirror/search';
import {parseDocument, LineCounter} from 'yaml';

const syntax = HighlightStyle.define([
  {tag:[tags.propertyName,tags.attributeName,tags.labelName],color:'var(--code-key)'},
  {tag:[tags.string,tags.special(tags.string)],color:'var(--code-string)'},
  {tag:[tags.bool,tags.null,tags.keyword,tags.atom],color:'var(--code-atom)'},
  {tag:[tags.number,tags.integer,tags.float],color:'var(--code-number)'},
  {tag:[tags.comment,tags.lineComment],color:'var(--code-comment)'},
  {tag:[tags.punctuation,tags.bracket,tags.operator],color:'var(--code-punctuation)'}
]);
const language = type => type === 'sing-box' ? json() : StreamLanguage.define(yamlLanguage);

export function makeEditor({parent,doc,type='mihomo',onUpdate=()=>{},onSave=()=>{},readOnly=false,changedLines=[],side=''}) {
  const compartment = new Compartment();
  const extensions = [
    Prec.highest(keymap.of([{key:'Mod-s',run:()=>{onSave();return true;}}])),
    basicSetup, keymap.of([indentWithTab]), indentUnit.of('  '),
    compartment.of(language(type)), syntaxHighlighting(syntax),
    EditorState.tabSize.of(2),
    EditorView.contentAttributes.of({'aria-label':readOnly?'配置修改对比':'代理配置编辑区',spellcheck:'false',autocapitalize:'off'}),
    EditorView.updateListener.of(update=>{if(update.docChanged||update.selectionSet)onUpdate(update);})
  ];
  if(readOnly)extensions.push(EditorState.readOnly.of(true),EditorView.editable.of(false));
  else extensions.push(lintGutter());
  const state=EditorState.create({doc,extensions});
  if(changedLines.length){
    const decorations=changedLines.filter(line=>line>0&&line<=state.doc.lines).map(line=>Decoration.line({class:'cm-diff-line-'+side}).range(state.doc.line(line).from));
    extensions.push(EditorView.decorations.of(Decoration.set(decorations,true)));
  }
  const view=new EditorView({state:EditorState.create({doc,extensions}),parent});
  return {
    view,
    text:()=>view.state.doc.toString(),
    set(text,type){view.dispatch({changes:{from:0,to:view.state.doc.length,insert:text},effects:compartment.reconfigure(language(type))});view.dispatch(setDiagnostics(view.state,[]));},
    diagnostics(items){view.dispatch(setDiagnostics(view.state,items.map(item=>({from:Math.min(view.state.doc.length,Math.max(0,item.from)),to:Math.min(view.state.doc.length,Math.max(item.from,item.to)),severity:'error',message:item.message}))));},
    jump(line){const target=view.state.doc.line(Math.min(Math.max(1,line),view.state.doc.lines));view.dispatch({selection:{anchor:target.from}});view.scrollDOM.scrollTop=Math.max(0,view.lineBlockAt(target.from).top-view.scrollDOM.clientHeight/2);view.focus();},
    search(){openSearchPanel(view);},
    destroy(){view.destroy();}
  };
}

export function syntaxCheck(text,type){
  const diagnostics=[];
  if(!text.trim())return [{from:0,to:0,line:1,message:'配置文件不能为空。'}];
  if(type==='sing-box'){
    try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('配置根节点应为 JSON 对象。');}
    catch(error){const position=Number(error.message.match(/position (\d+)/)?.[1]||0);const line=Number(error.message.match(/line (\d+)/)?.[1]||text.slice(0,position).split('\n').length);diagnostics.push({from:position,to:Math.min(text.length,position+1),line,message:error.message});}
  }else{
    const counter=new LineCounter();
    const doc=parseDocument(text,{lineCounter:counter,uniqueKeys:true});
    for(const error of doc.errors){const from=error.pos?.[0]||0;diagnostics.push({from,to:error.pos?.[1]||from,line:counter.linePos(from).line,message:error.message.split('\n\n')[0]});}
    if(!diagnostics.length){try{const value=doc.toJS({maxAliasCount:30});if(!value||typeof value!=='object'||Array.isArray(value))diagnostics.push({from:0,to:Math.min(text.length,1),line:1,message:'配置根节点应为 YAML 映射。'});}catch(error){diagnostics.push({from:0,to:0,line:1,message:error.message});}}
  }
  return diagnostics;
}

export function differences(original,current){
  const a=original.split('\n'),b=current.split('\n'),removed=[],added=[];
  if(a.length*b.length>1000000){let first=0,lastA=a.length-1,lastB=b.length-1;while(first<a.length&&first<b.length&&a[first]===b[first])first++;while(lastA>=first&&lastB>=first&&a[lastA]===b[lastB]){lastA--;lastB--;}for(let i=first;i<=lastA;i++)removed.push(i+1);for(let i=first;i<=lastB;i++)added.push(i+1);return{removed,added};}
  const matrix=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)matrix[i][j]=a[i]===b[j]?1+matrix[i+1][j+1]:Math.max(matrix[i+1][j],matrix[i][j+1]);
  let i=0,j=0;while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){i++;j++;}else if(j<b.length&&(i===a.length||matrix[i][j+1]>=matrix[i+1][j]))added.push(++j);else removed.push(++i);}
  return{removed,added};
}
