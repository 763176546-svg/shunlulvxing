const text=(value,max=500)=>typeof value==='string'?value.slice(0,max):''
export function safeLink(value){
 if(typeof value!=='string')return ''
 try{const url=new URL(value);return url.protocol==='https:'&&['router.feizhu.com','www.fliggy.com','h5.m.taobao.com','market.m.taobao.com'].includes(url.hostname)&&!url.username&&!url.password?value:''}catch{return ''}
}
export function safeImage(value){
 if(typeof value!=='string')return ''
 try{const url=new URL(value.startsWith('//')?'https:'+value:value);return url.protocol==='https:'&&(url.hostname==='img.alicdn.com'||url.hostname.endsWith('.alicdn.com'))?url.href:''}catch{return ''}
}
export function normalize(data,kind){
 if(!data||data.status!==0||!Array.isArray(data.data?.itemList))throw Error('unsupported response')
 return data.data.itemList.filter(item=>item&&typeof item.name==='string'&&item.name.trim()).slice(0,30).map((item,index)=>{
   const ticket=kind==='scenic'?item.ticketInfo:null
   const price=kind==='hotel'?item.price:ticket?.price
   return {
     id:text(String(kind==='hotel'?item.shId||item.id||'hotel:'+item.name+'|'+(item.address||''):item.id||index),450),
     name:text(item.name,180),address:text(item.address,300),
     image:safeImage(item.mainPic),
     ...(kind==='scenic'?{description:text(item.description,1500)}:{}),
     category:text(kind==='hotel'?item.star:item.category,80),
     nearby:text(item.interestsPoi,120),
     ...(kind==='hotel'?{rating:Number(item.score||item.rate)||null}:{}),
     price:typeof price==='number'&&Number.isFinite(price)&&price>=0?String(price):text(price,50).trim(),
     priceLabel:kind==='hotel'?'飞猪返回参考价':'关联商品参考价',
     productName:text(ticket?.ticketName,200),
     priceDate:text(ticket?.priceDate,50),
     jumpUrl:safeLink(kind==='hotel'?item.detailUrl:item.jumpUrl)
   }
 })
}
