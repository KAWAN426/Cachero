const select = async (info, queryForm, key) => {
  const { data, count } = info;

  checkQueryFormVaild(info, queryForm)

  const cachedKeyValid = info.cachedKey ? info.cachedKey.includes(key) : true;

  if (cachedKeyValid || data.length === count) {
    let resultData = JSON.parse(JSON.stringify(data));

    if ("column" in queryForm) resultData = interpretColumn(info, queryForm.column, resultData)

    if ("order" in queryForm) resultData = interpretOrder(queryForm.order, resultData)

    if ("where" in queryForm) resultData = interpretWhere(resultData, queryForm.where)

    if ("offset" in queryForm) resultData = resultData?.slice(queryForm.offset)

    if ("limit" in queryForm) resultData = resultData?.slice(0, queryForm.limit)

    if (resultData && resultData.length > 0) return resultData
  }
  const result = await selectQueryResult(info, queryForm, key)
  return result
}

function interpretOrder(orderForm, data) {
  return data?.sort((a, b) => compareData(a, b, orderForm));
}

function compareData(a, b, keys, index = 0) {
  const keyArray = keys[index].split(" ")
  const order = keyArray.length === 2 ? keyArray[1] : "ASC"
  const key = keyArray[0];
  const x = a[key];
  const y = b[key];

  if (a[key] === b[key]) {
    if (index < keys.length - 1) {
      return compareData(a, b, keys, index + 1);
    } else {
      return 0;
    }
  }

  if (typeof x === 'number' && typeof y === 'number') {
    if (order === "DESC") return y - x;
    else return x - y;
  } else if (isDateString(x) && isDateString(y)) {
    // @ts-ignore
    if (order === "DESC") return new Date(y) - new Date(x);
    // @ts-ignore
    else return new Date(x) - new Date(y);
  }
  else {
    if (order === "DESC") {
      if (x > y) return -1;
      else if (x < y) return 1;
      else return 0;
    } else {
      if (x < y) return -1;
      else if (x > y) return 1;
      else return 0;
    }
  }
}

function interpretColumn({ tableName, tableColumns }, columnForm, data) {
  const columnList = []

  columnForm.forEach((column) => {
    const dotResult = column.match(/\.(\w+)/);
    const isIncludeNotTableName = column.includes(".*") && !column.includes(tableName);
    const isIncludeAS = column.includes(" AS ") ? " AS " : null || column.includes(" as ") ? " as " : null
    let resultColumn = column;
    if (isIncludeAS) {
      resultColumn = column.split(isIncludeAS)[1]
    } else if (column === `${tableName}.*` || column === "*") {
      return columnList.push(...tableColumns)
    } else if (isIncludeNotTableName) {
      throw Error(`You can't send column like this: anotherTable.*`);
    } else if (dotResult && dotResult.length > 1) {
      resultColumn = dotResult[1]
    }
    if (columnList.includes(resultColumn)) throw Error("Wrong Column Selected");
    return columnList.push(resultColumn)
  })

  let isIncorrectColumn = false
  const result = data.map((obj) => {
    const filteredObj = {};
    columnList.forEach((key) => {
      if (obj.hasOwnProperty(key)) { // TODO: 프로포티값이 없을 경우 어떻게할것인지 추가
        filteredObj[key] = obj[key];
      } else {
        isIncorrectColumn = true
      }
    });
    return filteredObj;
  });

  if (isIncorrectColumn) return [];
  return result
}

async function selectQueryResult({ pool, tableName, deleted, cachedKey, data, redis }, queryForm, key) {
  const queryProps = []
  const where = queryForm.where ? "WHERE " + queryForm.where.result.map((condition) => {
    if (condition === "&&" || condition === "||") return condition
    if (!(condition in queryForm.where) || queryForm.where[condition].length !== 3) throw Error("Result contains undefined conditions")
    const [key, operator, value] = queryForm.where[condition]
    if (operator === "IN" || operator === "NOT IN") {
      return key + operator + `(${Array.isArray(value) ? value.map((valueData) => {
        queryProps.push(valueData);
        return `$${queryProps.length}`;
      }).join(',') : () => {
        queryProps.push(value);
        return `$${queryProps.length}`;
      }})`
    } else {
      queryProps.push(value)
      return `${key} ${operator} $${queryProps.length}`
    }
  }).join(" ") : ""

  const join = queryForm.join ? "JOIN " + queryForm.join : ""
  const columnList = queryForm.column ? queryForm.column.join(", ") : '*'
  const order = queryForm.order ? "ORDER BY " + queryForm.order.join(", ") : ""
  const limit = queryForm.limit ? "LIMIT " + queryForm.limit : ""
  const offset = queryForm.offset ? "OFFSET " + queryForm.offset : ""
  const result = await pool.query(`
    SELECT ${columnList}
    FROM ${tableName}
    ${join}
    ${where}
    ${order}
    ${limit}
    ${offset};
  `, queryProps);

  deleted.forEach(({ key, value }) => {
    result.rows.forEach((resultData, index) => {
      if (resultData[key] === value) delete result.rows[index]
    })
  })

  cachedKey.push(key)
  const selectResult = JSON.parse(JSON.stringify(result.rows))
  selectResult.forEach(newObj => {
    const existingObjIndex = data.findIndex(obj => obj.id === newObj.id);
    if (existingObjIndex !== -1) {
      data[existingObjIndex] = { ...data[existingObjIndex], ...newObj }; // 이미 있는 오브젝트를 덮어씌우면서 새로운 키를 추가
    } else {
      data.push(newObj); // 새로운 오브젝트를 추가
    }
  });
  if (redis) redis.set(tableName, JSON.stringify(data))
  return result.rows
}

function checkQueryFormVaild({ tableName }, queryForm) {
  queryForm.column.forEach((column) => {
    if (column.includes(".*") && !column.includes(tableName)) {
      throw Error(`You can't send column like this: anotherTable.*`);
    }
  })
}

function isDateString(inputString) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const timestampWithTimeZonePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/;
  const dateTest = datePattern.test(inputString)
  const timestampTest = timestampPattern.test(inputString)
  const timestampWithTimeZone = timestampWithTimeZonePattern.test(inputString)
  if (dateTest || timestampTest || timestampWithTimeZone) return true
  return false
}


function evaluateCondition(condition, item) {
  const [condKey, operator, value] = condition;

  if (condKey.includes(" AS ") || condKey.includes(" as ")) throw Error("Where's condition cannot contain 'AS'");

  const key = condKey.split('.')[0]

  function checkLikeData() {
    const checkEndData = item[key][0] === "%";
    const checkStartData = item[key][item[key].length - 1] === "%";
    const onlyValue = value.replace(/\%/g, '');
    const isEndsWith = item[key].endsWith(onlyValue)
    const isStartsWith = item[key].startsWith(onlyValue)

    if (checkEndData && !checkStartData) return isEndsWith
    else if (!checkEndData && checkStartData) return isStartsWith
    else return isEndsWith && isStartsWith
  }
  switch (operator) {
    case '=':
      return item[key] == value;
    case '==':
      return item[key] == value;
    case '!=':
      return item[key] != value;
    case '<>':
      return item[key] != value;
    case '>':
      return item[key] > value;
    case '<':
      return item[key] < value;
    case '>=':
      return item[key] >= value;
    case '<=':
      return item[key] <= value;
    case 'IN':
      return value.includes(item[key]);
    case 'NOT IN':
      return !value.includes(item[key]);
    case 'ILIKE':
      return checkLikeData()
    case 'LIKE':
      return checkLikeData()
    default:
      return true;
  }
}

function interpretWhere(data, conditions) {
  return data?.filter((filterData) => {
    const totalCondition = {}
    Object.keys(conditions).forEach((key) => {
      if (key === "result") return;
      totalCondition[key] = evaluateCondition(conditions[key], filterData)
    })
    const resultCon = conditions.result.map((result) => {
      if (result === "&&" || result === "||") return result
      else if (result in totalCondition) return String(totalCondition[result])
      throw Error("Result contains undefined conditions")
    }).join(" ")
    return eval(resultCon)
  })
}

exports.select = select