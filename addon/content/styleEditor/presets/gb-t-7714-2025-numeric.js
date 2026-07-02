const INFO = {
  id: "gb-t-7714-2015-numeric",
  title: "GB/T 7714-2015 (Numeric)",
  description: "GB/T 7714-2015 (Numeric)",
  citationType: "intext-citation",
  creator: [
    {
      type: "author",
      name: "jiaojiaodubai",
      email: "jiaojiaodubai23@gmail.com",
    }
  ],
  tags: ["Chinese", "GB/T", "GB/T 7714-2015", "Numeric"],
  documentation: ["https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=C6CE52E55AC09B9C79A20AEA77CEDD14"],
  license: "MIT",
  updated: "2026-06-29T14:12:13+08:00",
};

/**
 * @returns { ScriptResult<"intext-citation"> }
 */
function generate() {
  const uniqueCites = [];
  for (const ctx of contexts) {
    for (const cite of ctx.cites) {
      const isExist = uniqueCites.some(i => i.item.key === cite.item.key);
      if (!isExist) {
        uniqueCites.push(cite);
      }
    }
  }
  const getOrder = (cite) => {
    const index = uniqueCites.findIndex(i => i.item.key === cite.item.key);
    return index + 1;
  };
  const bibliography = uniqueCites.map((cite) => {
    const order = affix(getOrder(cite), "[", "]");
    const content = affix(dispatcher(cite), "", ".");
    return {
      id: cite.item.key,
      type: "bibliography-entry",
      units: group([order, content], "\t")
    };
  });
  const genCitation = (context) => {
    // 在折叠之前先排序，尽可能让相邻的数字集中出现
    const orders = context.cites
      .toSorted((a, b) => {
        const orderA = getOrder(a);
        const orderB = getOrder(b);
        return orderA - orderB;
      })
      .map(getOrder);
    const order2key = (order) => {
      const key = uniqueCites.find(i => getOrder(i) === order)?.item.key;
      return key;
    };
    if (orders.length === 1) {
      return {
        id: context.id,
        units: withStyle(
          affix(
            text(
              orders[0],
              { link: `banyan://entry/${order2key(orders[0])}` }
            ),
            "[",
            "]"
          ),
          { script: "superscript" }
        )
      };
    }
    const wrapped = [];
    for (let i = 0; i < orders.length; i++) {
      const current = orders[i];
      const lastRange = wrapped[wrapped.length - 1];
      if (lastRange && lastRange.end + 1 === current) {
        lastRange.end = current;
      } else {
        wrapped.push({ start: current, end: current });
      }
    }
    return {
      id: context.id,
      units: withStyle(
        affix(
          group(
            wrapped.map((r) => {
              const { start, end } = r;
              const startUnit = text(start, { link: `banyan://entry/${order2key(start)}` });
              const endUnit = text(end, { link: `banyan://entry/${order2key(end)}` });
              return start === end
                ? startUnit
                : group([startUnit, endUnit], "-");
            }),
            "，"
          ),
          "[",
          "]"
        ),
        { script: "superscript" }
      )
    };
  };
  return {
    citations: contexts.map(genCitation),
    bibliography: bibliography,
  };
}

/**
 * @param {Cite} cite
 */
function dispatcher(cite) {
  const isZh = isChinese(cite);
  const literatureCode = getLiteratureCode(cite);
  const itemType = cite.item.itemType;
  const typeCode = getTypeCode(cite);
  const creators = getCreators(cite);
  const hasAuthor = cite.item.creators.some(c => c.creatorType === "author");
  const date = getDate(cite);
  const page = getPage(cite);
  const accessed = getAccessed(cite);
  const doi = getDOI(cite);
  /* 图书 */
  if (itemType === "book") {
    return group([
      getCreators(cite, ["author", "editor"]),
      group([
        cite.item.title,
        affix(cite.item.seriesTitle, "："),  
        affix(cite.item.volume, "："),
        typeCode
      ]),
      group([
        // 可以获取到作者的情况下，才显示编者
        when(hasAuthor, affix(getCreators(cite, "editor"), "", isZh ? "，编" : " Ed.")),
        affix(getCreators(cite, "translator"), "", isZh ? "，译" : " Trans.")
      ], "；"),
      cite.item.edition,
      group([
        group([
          group([
            group([
              getPublishPlace(cite),
              getPublisher(cite)
            ], "："),
            date
          ], "，"),
          page
        ], "：")
      ]),
      accessed,
      doi
    ], ". ");
  }
  /* 图书中析出的文献 */
  if (itemType === "bookSection") {
    return group([
      group([
        getCreators(cite, ["author", "editor"]),
        group([
          cite.item.title,
          typeCode
        ]),
        group([
          affix(getCreators(cite, "translator"), "", isZh ? "，译" : " Trans."),
          // 可以获取到作者的情况下，才显示编者
          when(hasAuthor, affix(getCreators(cite, "editor"), "", isZh ? "，编" : " Ed.")),
        ], "；")
      ], ". "),
      group([
        getCreators(cite, "bookAuthor"),
        group([
          cite.item.bookTitle,
          affix(cite.item.seriesTitle, "："),
          affix(cite.item.volume, "："),
        ]),
        cite.item.edition,
        group([
          group([
            group([
              getPublishPlace(cite),
              getPublisher(cite)
            ], "："),
            date
          ], "，"),
          page
        ], "："),
        accessed,
        doi
      ], ". ")
    ], "//");
  }
  /* 连续出版物 */
  if (itemType === "journalArticle" && !cite.item.title) {
    return group([
      creators,
      group([
        cite.item.title,
        typeCode
      ]),
      group([
        group([
          group([
            date,
            affix(cite.item.volume, "，"),
          ], "，"),
          affix(cite.item.issue, "（", "）")
        ]),
        "—",
        group([
          group([
            getExtraValue(cite.item, "date2"),
            affix(getExtraValue(cite.item, "voolume2"), "，"),
          ], "，"),
          affix(getExtraValue(cite.item, "issue2"), "（", "）")
        ]),
      ]),
      group([
        group([
          getPublishPlace(cite),
          cite.item.publisher
        ], "："),
        group([
          date,
          "—",
          getExtraValue(cite.item, "date2")
        ])
      ], "，"),
      accessed,
      doi
    ], ". ");
  }
  switch (literatureCode) {
  /* 连续出版物中析出的文献 */
  case "N":
  case "J":
    return group([
      creators,
      group([cite.item.title, typeCode]),
      getCreators(cite, "translator"),
      group([
        group([
          group([
            fallback([cite.item.journalAbbreviation, cite.item.publicationTitle]),
            cite.item.volume
          ], "，"),
          affix(
            when(itemType === "newspaperArticle", page, cite.item.issue),
            "（",
            "）"
          ),
        ]),
        affix(when(itemType === "journalArticle", page))
      ], "："),
      accessed,
      doi
    ], ". ");
  /* 会议录中析出的文献 */
  case "C":
    return group([
      group([
        group([
          creators,
          group([cite.item.title, typeCode]),
        ], ". "),
        group([
          group([
            cite.item.conferenceName,
            date
          ], "，"),
          page
        ], "：")
      ], "//"),
      accessed,
      doi
    ], ". ");
  /* 学位论文 */
  case "D":
    return group([
      creators,
      group([cite.item.title, typeCode]),
      group([
        group([
          getPublishPlace(cite),
          getPublisher(cite)
        ], "："),
        group([
          date,
          page,
        ], "："),
      ], "，"),
      accessed,
      doi
    ], ". ");
  /* 报告 */
  case "R":
    return group([
      creators,
      group([
        cite.item.title,
        affix(cite.item.seriesTitle, "："),
        affix(cite.item.reportNumber, "："),
        typeCode
      ]),
      group([
        date,
        affix(page, "：")
      ]),
      accessed,
      doi
    ], ". ");
  /* 标准 */
  case "S":
    return group([
      group([
        group([
          cite.item.number,
          cite.item.title
        ],"　"),
        typeCode
      ]),
      accessed,
      doi
    ], ". ");
  /* 专利 */
  case "P": {
    const hasInventor = cite.item.creators.some((c) => c.creatorType === "inventor");
    const authors = hasInventor
      ? getCreators(cite, "inventor")
      : cite.item.assignee;
    return group([
      authors,
      group([
        cite.item.title,
        affix(fallback([cite.item.patentNumber, cite.item.applicationNumber]), "："),
        typeCode
      ]),
      group([
        fallback([getDate(cite, "date"), getDate(cite, "filingDate")]),
        affix(page, "：")
      ]),
      accessed,
      doi
    ], ". ");
  }
  /* 网页 */
  case "CP":
  case "EB":
    return group([
      creators,
      group([cite.item.title, typeCode]),
      group([
        affix(date, "（", "）"),
        affix(getDate(cite, "accessDate"), "[", "]"),
      ]),
      accessed,
      doi
    ], ". ");
  /* 档案 */
  case "A":
    return group([
      creators,
      group([
        cite.item.title,
        affix(cite.item.archiveLocation, "："),
        typeCode
      ]),
      group([
        group([
          getPublishPlace(cite),
          getPublisher(cite),
        ], "："),
        group([
          date,
          page,
        ], "："),
      ], "，"),
      accessed,
      doi
    ], ". ");
  /* 地图 */
  case "CM":
    return group([
      creators,
      cite.item.title,
      group([
        cite.item.scale,
        typeCode
      ]),
      cite.item.edition,
      group([
        group([
          getPublishPlace(cite),
          getPublisher(cite),
        ], "："),
        date
      ], "，"),
      getExtraValue(cite.item, "size"),
      accessed,
      doi
    ], ". ");
  /* 数据集 */
  case "DS":
    return group([
      creators,
      group([
        cite.item.title,
        typeCode
      ]),
      cite.item.versionNumber,
      group([
        cite.item.repository,
        affix(date, "（", "）"),
        affix(getDate(cite, "accessDate"), "[", "]"),
      ]),
      accessed,
      doi
    ], ". ");
  /* 预印本 */
  case "PP":
    return group([
      creators,
      group([
        cite.item.title,
        affix(cite.item.series, "："),
        typeCode
      ]),
      getExtraValue(cite.item, "version"),
      group([
        cite.item.repository,
        affix(date, "（", "）"),
        affix(getDate(cite, "accessDate"), "[", "]")
      ]),
      accessed,
      doi
    ]);
  }
  return "";
}

/**
 * @param {Cite} cite
 * @param {CreatorType | CreatorType[]} type
 */
function getCreators(cite, type = "author") {
  const isZh = isChinese(cite);
  const etal = isZh ? "，等" : " et al.";
  const creators = [];
  if (!Array.isArray(type)) {{
    creators.push(...cite.item.creators.filter(c => c.creatorType === type));
  }}
  else {
    for (const t of type) {
      creators.push(...cite.item.creators.filter(c => c.creatorType === t));
      if (creators.length) {
        break;
      }
    }
  }
  if (creators.length > 3) {
    return affix(
      group(creators.slice(0, 3).map(c => getCreator(c, isZh)), "，"),
      "",
      etal
    );
  }
  return group(creators.map(c => getCreator(c, isZh)), "，");
}

/**
 * @param {Creator} creator
 * @param {Boolean} isZh
 */
function getCreator(creator, isZh) {
  const { firstName, lastName, name } = creator;
  if (name) {
    return name;
  }
  if (isZh) {
    return `${lastName}${firstName}`;
  }
  return group([
    textCase(lastName, "name"),
    ...firstName.split(" ").map(s => textCase(s.charAt(0), "upper"))
  ], " ");
}

/**
 * @param {Cite} cite 
 */
function isChinese(cite) {
  return /^zh\b/.test(cite.item.language);
}

/**
 * @param {Cite} cite 
 */
function getTypeCode(cite) {
  return affix(
    group([
      getLiteratureCode(cite),
      getMediaCode(cite)
    ], "/"),
    "[",
    "]"
  );
}

/**
 * @param {Cite} cite 
 */
function getLiteratureCode(cite) {
  const itemType = cite.item.itemType;
  const cslType = cite.item.extra["type"];
  const typeMap = {
    bookSection: "M",
    journalArticle: "J",
    newspaperArticle: "N",
    conferencePaper: "C",
    thesis: "D",
    report: "R",
    standard: "S",
    patent: "P",
    webpage: "EB",
    document: "A",
    map: "CM",
    preprint: "PP",
    software: "CP",
  };
  if (itemType in typeMap) {
    return typeMap[itemType];
  }
  if (itemType === "book") {
    if (cslType === "collection") {
      return "G";
    }
    if (cslType === "proceedings") {
      return "C";
    }
    return "M";
  }
  if (itemType === "dataset") {
    if (cslType === "database") {
      return "DB";
    }
    return "DS";
  }
  return "Z";
}

/**
 * @param {Cite} cite 
 */
function getMediaCode(cite) {
  const itemType = cite.item.itemType;
  const media = cite.item.extra["media"];
  if (["webpage", "dataset"].includes(itemType)) {
    return "OL";
  }
  return media;
}

/**
 * @param {Cite} cite 
 */
function getPublishPlace(cite) { 
  const isZh = isChinese(cite);
  const place = cite.item.place;
  if (!place && !isElectronic(cite)) {
    return isZh ? "[出版地不详]" : "[S.l.]";
  }
  return isZh ? place : textCase(place.replace(/,\s?/g, "，"), "title");
}

/**
 * @param {Cite} cite 
 */
function getPublisher(cite) {
  const isZh = isChinese(cite);
  let publisher = cite.item.publisher;
  if (cite.item.itemType === "thesis") {
    publisher = cite.item.university;
  }
  if (!publisher && !isElectronic(cite)) {
    return isZh ? "[出版者不详]" : "[s.n.]";
  }
  return isZh ? publisher : textCase(publisher.replace(/,\s?/g, "，"), "title");
}

/**
 * @param {Cite} cite
 * @param {String} prop
 */
function getDate(cite, prop="date") {
  const itemType = cite.item.itemType;
  const date = cite.item[prop];
  const nonAdYear = getExtraValue(cite.item, "non-ad-year");
  if (!date) {
    return "";
  }
  const dateObj = new Date(date);
  const year = dateObj.getFullYear().toString();
  const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
  const day = dateObj.toString().padStart(2, "0");
  const fullDate = [year, month, day].join("-");
  const isOnlineJournal = itemType === "journalArticle" && cite.item.extra["onlineJournal"];
  const isNewspaper = itemType === "newspaperArticle";
  const isReport = itemType === "report";
  const isPatent = itemType === "patent";
  const isDocument = itemType === "document";
  if (isOnlineJournal || isNewspaper || isReport || isPatent || isDocument) {
    return fullDate;
  }
  if (isElectronic(cite)) {
    return fullDate;
  }
  return affix(year, affix(nonAdYear, "（", "）"));
}

/**
 * @param {Cite} cite 
 */
function isElectronic(cite) {
  const electronic = [
    "webpage",
    "dataset",
    "preprint",
    "software"
  ];
  return electronic.includes(cite.item.itemType);
}

/**
 * @param {Cite} cite
 */
function getPage(cite) {
  const page = cite.item.pages;
  return fallback([page, getExtraValue(cite.item, "article-number")]);
}

/**
 * @param {Cite} cite
 */
function getAccessed(cite) {
  const https = "https://";
  const url = cite.item.url;
  if (!url && !/\w+:\/\//.test(url)) {
    // set https as default protocol for URLs without protocol
    return affix(url, https);
  }
  return url;
}

/**
 * @param {Cite} cite
 */
function getDOI(cite) {
  const doi = cite.item.DOI;
  const url = cite.item.url;
  if (url.includes(doi)) {
    return "";
  }
  return affix(doi, "DOI：https://doi.org/");
}
