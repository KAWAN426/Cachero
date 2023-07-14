import { ICacheInfo } from "types";

export function update<T>(info:ICacheInfo<T>, newData:T[] | T) {
  const { data, redis, tableName, refKey } = info
  if(!tableName || !refKey) throw Error("You should setting before use select");
  const updateData:T[] | T = JSON.parse(JSON.stringify(newData))
  if (Array.isArray(updateData)) {
    updateData.forEach(newData => {
      mergeData<T>(data, refKey, newData);
    });
  } else {
    mergeData<T>(data, refKey, updateData);
  }

  if (redis) redis.set(tableName, JSON.stringify(data))
}

function mergeData<T>(data:T[], key:keyof T, updateData:T) {
  const existingObjIndex = data.findIndex(obj => obj[key] === updateData[key]);
  if (existingObjIndex !== -1) {
    return data[existingObjIndex] = { ...data[existingObjIndex], ...updateData }; // 이미 있는 오브젝트를 덮어씌우면서 새로운 키를 추가
  } else {
    return data.push(updateData); // 새로운 오브젝트를 추가
  }
}