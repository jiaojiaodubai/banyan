const INFO = {
  id: "gb-t-7714-2015-author-year",
  title: "GB/T 7714-2025 (Author-Year)",
  description: "GB/T 7714-2025 (Author-Year)",
  citationType: "intext-citation",
  creator: [
    {
      type: "author",
      name: "jiaojiaodubai",
      email: "jiaojiaodubai23@gmail.com",
    }
  ],
  tags: ["Chinese", "GB/T", "GB/T 7714-2015", "Author-Year"],
  documentation: ["https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=C6CE52E55AC09B9C79A20AEA77CEDD14"],
  license: "MIT",
  updated: "2026-06-25T10:23:23+08:00",
};

const UI = {
  citation: [
    {
      id: "author-outside",
      label: "作者显示在括号外",
      type: "checkbox",
      value: false,
    }
  ],
  cite: [],
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
  // @ts-ignore
  const sortedCites = uniqueCites.toSorted((/** @type {Cite} */ a, /** @type {Cite} */ b) => {
    const ca = plainText(getMainCreators(a));
    const cb = plainText(getMainCreators(b));
    if (ca === cb) {
      const ya = new Date(a.item.date).getTime();
      const yb = new Date(b.item.date).getTime();
      return ya - yb;
    }
    return ca.localeCompare(cb);
  });
  /**
   * @param { Cite } cite
   */
  function getYear(cite) {
    const rawYear = (cite) => {
      const date = cite.item.date;
      if (!date) {
        return "";
      }
      return new Date(date).getFullYear().toString();
    };
    const year = rawYear(cite);
    const confilicts = sortedCites
      .filter(c => plainText(getMainCreators(c, true)) === plainText(getMainCreators(cite, true)))
      .filter(c => rawYear(c) === rawYear(cite));
    if (confilicts.length === 1) {
      return year;
    }
    const index = confilicts.findIndex(c => c.item.key === cite.item.key);
    return affix(year, "", String.fromCharCode(97 + index));
  }
  const bibliography = sortedCites.map((cite) => {
    const content = affix(dispatcher(cite, getYear(cite)), "", ".");
    return {
      id: cite.item.key,
      type: "bibliography-entry",
      units: content
    };
  });
  const genCitation = (/** @type { CitationContext } */ context) => {
    // @ts-ignore
    const cites = context.cites.toSorted((/** @type {Cite} */ a, /** @type {Cite} */ b) => {
      const ia = sortedCites.findIndex(i => i.item.key === a.item.key);
      const ib = sortedCites.findIndex(i => i.item.key === b.item.key);
      return ia - ib;
    });
    const outside = context.params["author-outside"];
    const authors = cites.map(c => getMainCreators(c, true));
    const authorSet = new Set(authors);
    const sameAuthor = authorSet.size === 1;
    if (outside && sameAuthor) {
      const author = authors[0];
      const units = group([
        author,
        affix(
          group(cites.map(c => getYear(c)), "；"),
          "（",
          "）"
        )
      ]);
      return {
        id: context.id,
        type: "intext-citation",
        units
      };
    }
    const units = affix(
      group(
        cites.map((c) => group([
          getMainCreators(c, true),
          getYear(c)
        ], "，")),
        "；"
      ),
      "（",
      "）"
    );
    return {
      id: context.id,
      type: "intext-citation",
      units
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
function dispatcher(cite, year) {
  const isZh = isChinese(cite);
  const literatureCode = getLiteratureCode(cite);
  const itemType = cite.item.itemType;
  const typeCode = getTypeCode(cite);
  const authorYear = group([
    getMainCreators(cite),
    year
  ], "，");
  const hasAuthor = cite.item.creators.some(c => c.creatorType === "author");
  const page = getPage(cite);
  const accessed = getAccessed(cite);
  const doi = getDOI(cite);
  /* 图书 */
  if (itemType === "book") {
    return group([
      authorYear,
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
            getPublishPlace(cite),
            getPublisher(cite)
          ], "："),
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
        authorYear,
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
            getPublishPlace(cite),
            getPublisher(cite)
          ], "："),
          page
        ], "："),
        accessed,
        doi
      ], ". ")
    ], "//");
  }
  switch (literatureCode) {
  /* 连续出版物中析出的文献 */
  case "N":
  case "J":
    return group([
      authorYear,
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
          authorYear,
          group([cite.item.title, typeCode]),
        ], ". "),
        group([
          cite.item.conferenceName,
          page
        ], "：")
      ], "//"),
      accessed,
      doi
    ], ". ");
  /* 学位论文 */
  case "D":
    return group([
      authorYear,
      group([cite.item.title, typeCode]),
      group([
        group([
          getPublishPlace(cite),
          getPublisher(cite)
        ], "："),
        page,
      ], "，"),
      accessed,
      doi
    ], ". ");
  /* 报告 */
  case "R":
    return group([
      authorYear,
      group([
        cite.item.title,
        affix(cite.item.seriesTitle, "："),
        affix(cite.item.reportNumber, "："),
        typeCode
      ]),
      page,
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
    return group([
      authorYear,
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
      authorYear,
      group([cite.item.title, typeCode]),
      affix(getDate(cite, "accessDate"), "[", "]"),
      accessed,
      doi
    ], ". ");
  /* 档案 */
  case "A":
    return group([
      authorYear,
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
        page,
      ], "，"),
      accessed,
      doi
    ], ". ");
  /* 地图 */
  case "CM":
    return group([
      authorYear,
      cite.item.title,
      group([
        cite.item.scale,
        typeCode
      ]),
      cite.item.edition,
      group([
        getPublishPlace(cite),
        getPublisher(cite),
      ], "："),
      getExtraValue(cite.item, "size"),
      accessed,
      doi
    ], ". ");
  /* 数据集 */
  case "DS":
    return group([
      authorYear,
      group([
        cite.item.title,
        typeCode
      ]),
      cite.item.versionNumber,
      group([
        cite.item.repository,
        affix(getDate(cite, "accessDate"), "[", "]"),
      ]),
      accessed,
      doi
    ], ". ");
  /* 预印本 */
  case "PP":
    return group([
      authorYear,
      group([
        cite.item.title,
        affix(cite.item.series, "："),
        typeCode
      ]),
      getExtraValue(cite.item, "version"),
      group([
        cite.item.repository,
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
 */
function getMainCreators(cite, short = false) {
  const itemType = cite.item.itemType;
  if (["book", "bookSection"].includes(itemType)) {
    return getCreators(cite, ["author", "editor"], short);
  }
  if (itemType === "patent") {
    const hasInventor = cite.item.creators.some((c) => c.creatorType === "inventor");
    return  hasInventor
      ? getCreators(cite, "inventor", short)
      : cite.item.assignee;
  }
  return getCreators(cite, "author", short);
}

/**
 * @param {Cite} cite
 * @param {CreatorType | CreatorType[]} type
 */
function getCreators(cite, type = "author", short = false) {
  const isZh = isChinese(cite);
  const etal = isZh
    ? short ? " 等" : "，等"
    : " et al.";
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
  if (!creators.length) {
    return "";
  }
  if (short) {
    if (creators.length > 1) {
      return affix(
        getCreator(creators[0], isZh),
        "",
        etal
      );
    }
    return getCreator(creators[0], isZh);
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
function getDate(cite, prop="date", forceYear = false) {
  const itemType = cite.item.itemType;
  const date = cite.item[prop];
  const nonAdYear = getExtraValue(cite.item, "non-ad-year");
  if (!date) {
    return "";
  }
  const dateObj = new Date(date);
  const year = dateObj.getFullYear().toString();
  if (forceYear) {
    return year;
  }
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
