// Model-free presentation. Values and user actions arrive through explicit arguments.
// This module owns no decision, storage, telemetry, or transition state.
export function createWorkspaceDom(document, { mountPrefix = "" } = {}) {
const priorityNames = new Map([
  [1, "Low (1)"],
  [3, "Middle (3)"],
  [5, "High (5)"],
  [8, "Emergency (8)"],
]);
function node(tag, attrs = {}, children = []) {
  const item = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") item.className = value;
    else item.setAttribute(key, String(value));
  }
  for (const child of children)
    item.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  return item;
}
function button(label, action, primary = false) {
  const b = node(
    "button",
    { type: "button", ...(primary ? { class: "dm-workspace__primary" } : {}) },
    [label],
  );
  b.addEventListener("click", action);
  return b;
}
const field = (label, input) =>
  node("label", { class: "dm-workspace__field" }, [label, input]);
  const heading = title => node("h2", {tabindex:"-1", "data-step-heading":""}, [title]);
  const actions = children => node("div", {class:"dm-workspace__actions"}, children);
  function resultTable(rows, { hasComparison, optionCount }) {
    const list=node('div',{class:'dm-workspace__result-list', 'aria-label':'Decision scores'});
    for(const row of rows){
      const card=node('article',{class:'dm-workspace__result','data-dm-result':'','data-option-id':row.id,'data-wins':row.wins},[
        node('div',{class:'dm-workspace__result-top'},[node('h3',{},[row.title]),node('strong',{},[hasComparison?row.wins+' points':row.prosCons+'/100'])])
      ]);
      if(hasComparison)card.append(node('p',{},['Chosen '+row.wins+' times in '+(optionCount-1)+' pairs.']));
      if(row.prosCons!==null){card.append(node('meter',{min:0,max:100,value:row.prosCons,'aria-label':'Pros and cons score for '+row.title}),node('p',{},['Pros and cons: '+row.prosCons+'/100']));}
      else if(hasComparison)card.append(node('p',{},['Pros and cons not reviewed.']));
      list.append(card);
    }
    return list;
  }
  function prioritySelect(value, label) {
    const select = node("select", { "aria-label": label });
    for (const [weight, optionLabel] of priorityNames) {
      const option = node("option", { value: weight }, [optionLabel]);
      option.selected = weight === value;
      select.append(option);
    }
    return select;
  }
  function storeLink(label) {
    return node('a',{href:'https://play.google.com/store/apps/details?id=org.emtalk.dm',target:'_blank',rel:'noopener noreferrer'},[label]);
  }
  function availability(){return node('p',{class:'dm-workspace__availability'},['Coming soon to the website. Coming soon to the App Store.']);}
  function aiEntry(label){
    const link=storeLink('');link.className='dm-workspace__ai';
    link.append(node('span',{class:'dm-workspace__ai-icon','aria-hidden':'true'},[node('img',{src:mountPrefix+'/media/dm/ai-options.svg',alt:'',width:24,height:24})]),node('span',{},[node('strong',{},[label]),node('small',{},['Available in the app on Google Play'])]),node('span',{'aria-hidden':'true'},['\u2197']));return link;
  }
  function aiNotice() {
    return node('aside',{class:'dm-workspace__notice'},[node('p',{},['AI assistance is available in the app. Coming soon to the website.']),storeLink('Get DM on Google Play'),node('p',{},['Coming soon to the App Store.'])]);
  }

  function topicCatalog({topics, categoryId, onCategory, onTopic}) {
    const card=node('section',{class:'dm-workspace__topics'},[node('h3',{},['Topics'])]);
    if (!topics) { card.append(node('p',{},['Topics could not be loaded. Add your own options below to start a decision.'])); return {element:card,categoryId:null}; }
    let category=topics.categories.find(item=>item.id===categoryId)||topics.categories[0];
    const categories=node('div',{class:'dm-workspace__categories',role:'radiogroup','aria-label':'Topic categories'});
    const list=node('div',{class:'dm-workspace__topic-list','aria-label':category.label+' topics'});
    const radios=[];
    function renderTopics() {
      list.setAttribute('aria-label',category.label+' topics');
      list.replaceChildren();
      for(const topic of category.topics){const select=button(topic.title,()=>onTopic(topic));select.dataset.dmTopic=topic.id;list.append(select);}
    }
    function selectCategory(id) {
      category=topics.categories.find(item=>item.id===id)||category;
      for(const radio of radios){const checked=radio.dataset.dmCategory===category.id;radio.setAttribute('aria-checked',String(checked));radio.tabIndex=checked?0:-1;}
      renderTopics();onCategory(category.id);
      const current=radios.find(radio=>radio.dataset.dmCategory===category.id);
      current.focus({preventScroll:true});current.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
    }
    for(const item of topics.categories){
      const select=button(item.label,()=>selectCategory(item.id));
      select.dataset.dmCategory=item.id;select.setAttribute('role','radio');
      select.setAttribute('aria-checked',String(item.id===category.id));select.tabIndex=item.id===category.id?0:-1;
      select.addEventListener('keydown',event=>{
        const index=radios.indexOf(select),last=radios.length-1;
        const next=event.key==='Home'?0:event.key==='End'?last:
          ['ArrowRight','ArrowDown'].includes(event.key)?(index+1)%radios.length:
          ['ArrowLeft','ArrowUp'].includes(event.key)?(index+last)%radios.length:null;
        if(next===null)return;
        event.preventDefault();selectCategory(radios[next].dataset.dmCategory);
      });
      radios.push(select);categories.append(select);
    }
    renderTopics();
    card.append(categories,list);return {element:card,categoryId:category.id};
  }
  function topicSelection({topic, maxOptions, onApply, onBack, onLimit}) {
    const selected=new Set();
    const count=node('p',{'role':'status','aria-live':'polite'},[`0 of ${maxOptions} selected`]);
    const choices=node('fieldset',{class:'dm-workspace__choices','data-dm-topic-options':''},[node('legend',{},['Options for this topic'])]);
    const apply=button('Use selected options',event=>onApply(topic.options.filter(title=>selected.has(title)),event),true);
    apply.disabled=true;
    for(const title of topic.options){
      const input=node('input',{type:'checkbox',value:title});
      input.addEventListener('change',()=>{
        if(input.checked && selected.size>=maxOptions){input.checked=false;onLimit(`Choose up to ${maxOptions} options. Uncheck one to choose another.`);return;}
        if(input.checked)selected.add(title);else selected.delete(title);
        count.textContent=`${selected.size} of ${maxOptions} selected`;apply.disabled=selected.size===0;
      });
      choices.append(node('label',{class:'dm-workspace__choice'},[input,title]));
    }
    return [heading(topic.title),node('p',{},[`Choose 1 to ${maxOptions} options that fit your situation. You can edit them before starting.`]),count,choices,actions([apply,button('Back to my options',onBack)])];
  }
  return Object.freeze({node,button,field,heading,actions,resultTable,prioritySelect,storeLink,availability,aiEntry,aiNotice,topicCatalog,topicSelection});
}
