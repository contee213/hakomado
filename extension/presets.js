// 既定のお気に入り: ホロライブ所属 (在籍中) のタレントと、ホロライブ公式系の YouTube チャンネル
// 2026-11-19 時点の公式サイト (hololive.hololivepro.com/talents) のタレント一覧から作成。
// 元データ: data/hololive-channels.json (卒業生なども含む全件)
/* exported PRESET_VERSION, PRESET_FAVORITES */
'use strict';

// 内容を更新したら上げる。上がると、まだ登録していないチャンネルが既存のお気に入りに追加される
const PRESET_VERSION = 2;

const PRESET_FAVORITES = [
  {
    channelId: "UCp6993wxpyDPHUpavwDFqgg",
    handle: "@TokinoSora",
    name: "ときのそら",
    group: "0期生",
    icon: "https://yt3.googleusercontent.com/QptILcxFIY8S6gku6TUj7koTTOsWRhqEudcdXASpfzOJwHcxxxCyRbizQ7xt4DtALFqDa5Kh=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCDqI2jOz0weumE8s7paEk6g",
    handle: "@Robocosan",
    name: "ロボ子さん",
    group: "0期生",
    icon: "https://yt3.googleusercontent.com/H8pRHxQm4-FjRl9XUFn9UQbJhVcj5PIvwDW6o7ZlBTRj2bgVP5xonQEl36H-O6NHaWmbP1zaxg=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC0TXe_LYZ4scaW2XMyi5_kw",
    handle: "@AZKi",
    name: "AZKi",
    group: "0期生",
    icon: "https://yt3.googleusercontent.com/tRZGMhn8vSvYE0_15SjaE_3dTH5JTZzjdnb5gs1StecT1tKn1gQ2tVkRfi_n42Q5fYz13ewdayo=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC-hM6YJuNYVAmUWxeIr9FeA",
    handle: "@SakuraMiko",
    name: "さくらみこ",
    group: "0期生",
    icon: "https://yt3.googleusercontent.com/b8EKl_i-e2dinoparyhUJEaRhInlSWwm-dZX0oIq-x1mUvQga530G_PIdutlSNkGKEAyX9aaBQ=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC5CwaMl1eIgY8h02uZw7u8A",
    handle: "@HoshimachiSuisei",
    name: "星街すいせい",
    group: "0期生",
    icon: "https://yt3.googleusercontent.com/ytc/AIdro_kLDBK5ksSvk5-XJ6S8e0kWfjy7mVl3jyUkgDeMQ7rlCpU=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCFTLzh12_nrtzqBPsTCqenA",
    handle: "@AkiRosenthal",
    name: "アキ・ローゼンタール",
    group: "1期生",
    icon: "https://yt3.googleusercontent.com/0Nx9jWdjiUrkizCVCDZg_MasdF6b85DAsQATmAkNC2A8b3Y89vXlnSDZ_v1fM_X4w3088sJnmA=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC1CfXB_kRs3C-zaeTG3oGyg",
    handle: "@AkaiHaato",
    name: "赤井はあと",
    group: "1期生",
    icon: "https://yt3.googleusercontent.com/jxI6FmNKDpYKXB0puyLhB5gq4JgWFvRT9Rr2C_d3hFT1q0SSOHh3QIUfvSxfTHupTXFnleqI=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCdn5BQ06XqgXoAxIhbqw5Rg",
    handle: "@ShirakamiFubuki",
    name: "白上フブキ",
    group: "1期生",
    icon: "https://yt3.googleusercontent.com/ytc/AIdro_mGXEeXXCCPh-sl2jKYbYpLBuCsjEGDgJaL5RQziYhyugQ=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCQ0UDLQCjY0rmuxCDE38FGg",
    handle: "@NatsuiroMatsuri",
    name: "夏色まつり",
    group: "1期生",
    icon: "https://yt3.googleusercontent.com/LZBvU0s_S-xi7fHmeab_iA8ztfGimxzisUBMODGKaIEx3r3R-tIDReiX3SlmbH2showigElJ=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC7fk0CB07ly8oSl0aqKkqFg",
    handle: "@NakiriAyame",
    name: "百鬼あやめ",
    group: "2期生",
    icon: "https://yt3.googleusercontent.com/3CeLWGYb6cLUywTJzNt-UpITviNxeGNvtjhIqbV-AIybCqCoFw9onWtg91bjwpqvfEP9mfqIR4Q=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC1suqwovbL1kzsoaZgFZLKg",
    handle: "@YuzukiChoco",
    name: "癒月ちょこ",
    group: "2期生",
    icon: "https://yt3.googleusercontent.com/gv-5tmPSiFipkP01atgnCS6WwdxzUxfermmqGw_UhuDNtRFmbdb2NALcL6rR0LxaM5JX9JhE9g=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCvzGlP9oQwU--Y0r9id_jnA",
    handle: "@OozoraSubaru",
    name: "大空スバル",
    group: "2期生",
    icon: "https://yt3.googleusercontent.com/ytc/AIdro_k5mjdt1wcbaYCXKwmDpVXmSGtOc-LH3WjIyUHVC4soP28=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCp-5t9SrOQwXMU7iIjQfARg",
    handle: "@OokamiMio",
    name: "大神ミオ",
    group: "ゲーマーズ",
    icon: "https://yt3.googleusercontent.com/JV8VdQFA7eZk5H1cRxHyIdLKQ5wD6EBywjxLzrne2EpY9LSiVgtapvh0iQA6plVNxdIKNxK0NRU=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCvaTdHTWBGv3MKj3KVqJVCw",
    handle: "@NekomataOkayu",
    name: "猫又おかゆ",
    group: "ゲーマーズ",
    icon: "https://yt3.googleusercontent.com/oD8ISaA35737mg-lt5mYSfOIXmjCeHYcSFFpTQn4AVMkqiyzrMle_THvX6NdfSxbjUO6fQ6_wg=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UChAnqc_AY5_I3Px5dig3X1Q",
    handle: "@InugamiKorone",
    name: "戌神ころね",
    group: "ゲーマーズ",
    icon: "https://yt3.googleusercontent.com/ytc/AIdro_nrS6tFctvjyWv1mKzKBIetHJBfpqwHOpvRFc3KU2P_5yc=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC1DCedRgGHBdm81E1llLhOQ",
    handle: "@usadapekora",
    name: "兎田ぺこら",
    group: "3期生",
    icon: "https://yt3.googleusercontent.com/B-5Iau5CJVDiUOeCvCzHiwdkUijqoi2n0tNwfgIv_yDAvMbLHS4vq1IvK2RxL8y69BxTwmPhow=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCvInZx9h3jC2JzsIzoOebWg",
    handle: "@ShiranuiFlare",
    name: "不知火フレア",
    group: "3期生",
    icon: "https://yt3.googleusercontent.com/XGJE8dQHKGyKma2oLZM-oZxF2c5OnQsjQx68tTowiPfh7gI2cHhP8REzXC7exvw2ri5QxFxEA-4=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCdyqAaZDKHXg4Ahi7VENThQ",
    handle: "@ShiroganeNoel",
    name: "白銀ノエル",
    group: "3期生",
    icon: "https://yt3.googleusercontent.com/ytc/AIdro_kIKJPVEqJLs9FNMgdti5WWHtc1t0MwihOlW-ZK90nGUdk=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCCzUftO8KOVkV4wQG1vkUvg",
    handle: "@HoushouMarine",
    name: "宝鐘マリン",
    group: "3期生",
    icon: "https://yt3.googleusercontent.com/RnFYoR_VkEZZ4OGRJz2cPXem1iRqMNzcGVp5LIxTRqhDu4vqckc83DBrVi2uwxiCPWEmmH6vSJk=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCqm3BQLlJfvkTsX_hvm0UmA",
    handle: "@TsunomakiWatame",
    name: "角巻わため",
    group: "4期生",
    icon: "https://yt3.googleusercontent.com/XJYar8ZAQ59ce0nFlf-Dl6V16Dwznu5xfh3XnMW_JE-nCVLHLiRTS-x1gB_eR4_CJY3KDfKxsVo=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC1uv2Oq6kNxgATlCiez59hw",
    handle: "@TokoyamiTowa",
    name: "常闇トワ",
    group: "4期生",
    icon: "https://yt3.googleusercontent.com/kF39-I4IfZJOWuGiciawwB-v4M_X9u6_-jxCvAiYSHSRuUS-LdpeWWRHO7c4Pk8sXROBaPl9iMQ=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCa9Y57gfeY0Zro_noHRVrnw",
    handle: "@HimemoriLuna",
    name: "姫森ルーナ",
    group: "4期生",
    icon: "https://yt3.googleusercontent.com/05zupy7ai3DW0mEmY3tSgkb4CGjHadAXG0bs_PSzg09l0_5MInPrG4Bh-ZRlAWcPncOe9cnQkQ=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCFKOVgVbGmX65RxO3EtH3iw",
    handle: "@YukihanaLamy",
    name: "雪花ラミィ",
    group: "5期生",
    icon: "https://yt3.googleusercontent.com/ytc/AIdro_nHPsjV8KMncrIzZh7NPGaG8xzAgzN8Vf9YAj12dRN7sCc=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCAWSyEs_Io8MtpY3m-zqILA",
    handle: "@MomosuzuNene",
    name: "桃鈴ねね",
    group: "5期生",
    icon: "https://yt3.googleusercontent.com/yQDRxiMIkbHsn7e4s6BCIBCNb3WmiV1myrpo6Lq2-dfCmAn1N47y12mhZg0NOfQMWQMYW4Qm=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCUKD-uaobj9jiqB-VXt71mA",
    handle: "@ShishiroBotan",
    name: "獅白ぼたん",
    group: "5期生",
    icon: "https://yt3.googleusercontent.com/WSOgf5zOOFKQN8pQB8VL8R6OSO0j81oGQSSzN22m8mts4VWZSPHDou7II8Lk4JA3OlQL-Iuu=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCK9V2B22uJYu3N7eR_BT9QA",
    handle: "@OmaruPolka",
    name: "尾丸ポルカ",
    group: "5期生",
    icon: "https://yt3.googleusercontent.com/42QEdu1EEbblI1N1nLIghEHb38jSbUCLBbSKBcjRf9_uPwN77Md5_iTXsCDkFU480_QEfTHJnQ=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCENwRMx5Yh42zWpzURebzTw",
    handle: "@LaplusDarknesss",
    name: "ラプラス・ダークネス",
    group: "holoX",
    icon: "https://yt3.googleusercontent.com/6Y5lj4DhikLBo0UqIZ1dT3-D3aYXVPbxUgNTyYiyE_Se8AVxkGAn05D3oc1y3whpzDu-CzEQ=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCs9_O1tRPMQTHQ-N_L6FU2g",
    handle: "@TakaneLui",
    name: "鷹嶺ルイ",
    group: "holoX",
    icon: "https://yt3.googleusercontent.com/hoR2TgfGwUZ4mbNY07Ygu88wPLY0JcArmFKZDTwaPOtJmK78gdIg3dmp87NZM8SRBCpxlv02hg=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC6eWCld0KwmyHFbAqK3V-Rw",
    handle: "@HakuiKoyori",
    name: "博衣こより",
    group: "holoX",
    icon: "https://yt3.googleusercontent.com/2PoZqbHNPXXxjPRgtAuDGY_p6use0QRNk2rN0oXPeE9NtrQGuTuD1psw6sCFDGy8fO_3JwjQPxw=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC_vMYWcDjmfdpH6r4TTn1MQ",
    handle: "@kazamairoha",
    name: "風真いろは",
    group: "holoX",
    icon: "https://yt3.googleusercontent.com/gq-oA6rRB25b8hLDHhsLqcU1ZSmuuEtIDQabDoaZV1NS-rwAzOit4RdQHz5Afh3mN4FwYnPIPg=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCWQtYtq9EOB4-I5P-3fh8lA",
    handle: "@OtonoseKanade",
    name: "音乃瀬奏",
    group: "ReGLOSS",
    icon: "https://yt3.googleusercontent.com/F6JBwH9DTYVbtij80QQ7sisiFWLOBv1MdNopYjU2CrcVSnjXU0ZDLU0XiP6G3LwSyX-B_PZ1-5o=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCtyWhCj3AqKh2dXctLkDtng",
    handle: "@IchijouRirika",
    name: "一条莉々華",
    group: "ReGLOSS",
    icon: "https://yt3.googleusercontent.com/guBD_mriQQ0zggwNTlJw9CwIXomW701w6q_8QsJ_Y3HvfI95AGiv-zcrQeyAdad6eKH9HoiN3Q=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCdXAk5MpyLD8594lm_OvtGQ",
    handle: "@JuufuuteiRaden",
    name: "儒烏風亭らでん",
    group: "ReGLOSS",
    icon: "https://yt3.googleusercontent.com/6aFGCylqMMh3ouhXoi_qkWJDO10HoWqpA-2wy6a3g0MWGepsRToWn0q-OvCbmkVX7lDWV3zt=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC1iA6_NT4mtAcIII6ygrvCw",
    handle: "@TodorokiHajime",
    name: "轟はじめ",
    group: "ReGLOSS",
    icon: "https://yt3.googleusercontent.com/IwEr_84NWbwSIRj6ZG3pt0yBieCqPcUwG978KkMw1HiVtorKvHhX3ZaLqOndMAfSU8S9aJw=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC9LSiN9hXI55svYEBrrK-tw",
    handle: "@IsakiRiona",
    name: "響咲リオナ",
    group: "FLOW GLOW",
    icon: "https://yt3.googleusercontent.com/4eNoZ3izogRHDyK8Bsoaz8rQwOGqCn6oumnmOr9GJ5RW4aD_lD03FSAnm7XNdmDFbuqM9mje=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCuI_opAVX6qbxZY-a-AxFuQ",
    handle: "@KoganeiNiko",
    name: "虎金妃笑虎",
    group: "FLOW GLOW",
    icon: "https://yt3.googleusercontent.com/YuUoz9D6C6cKCujiVYy_sWYYfLGPl52L4KKnq00SsKVzeBjAmN-NzHZFMx8niLhe_31qV5E9=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCjk2nKmHzgH5Xy-C5qYRd5A",
    handle: "@MizumiyaSu",
    name: "水宮枢",
    group: "FLOW GLOW",
    icon: "https://yt3.googleusercontent.com/dJtIwdARWIYw-6PVluASVT4Ugn1XvK-C8FTbWBU_niWacqOAtdfB4uvSiqmme-vJ65TO9KbeHA=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCKMWFR6lAstLa7Vbf5dH7ig",
    handle: "@RindoChihaya",
    name: "輪堂千速",
    group: "FLOW GLOW",
    icon: "https://yt3.googleusercontent.com/Stp3Ku6cyXyfOfhe-_QQQItPbBTKSUDm0ySR-VsbzbMxqJtGoyrIlI-O_rjqFB0F391WMBFA7A=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCGzTVXqMQHa4AgJVJIVvtDQ",
    handle: "@KikiraraVivi",
    name: "綺々羅々ヴィヴィ",
    group: "FLOW GLOW",
    icon: "https://yt3.googleusercontent.com/GoNhfGdAjTpVy0Ej1lHd1Sg42DZgyfwMD-E0Kt2QcjWV9RrKVEO9cxPFqOmxjGvB_pUAPugOSg=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC8eitCE9Z6EwUCs-VUi1blg",
    handle: "@AchichiMela",
    name: "熱千めら",
    group: "アソビ★まわり隊！",
    icon: "https://yt3.googleusercontent.com/w-0D87KiPH6FgFtJKtuodQYepQYJ-XHWMprRBNysqXpWN4FsyRZ4eweLg0xDgIHqThnWt7fD6w=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCROQtXcp2loQEmvpe5rhJzQ",
    handle: "@SorashinaSopia",
    name: "宙科そぴあ",
    group: "アソビ★まわり隊！",
    icon: "https://yt3.googleusercontent.com/YXxYUbMUyZJoaXHM6o6t5DrJKypsgFxrLoQofAa6gUlBpahlVI4fhcskR53XfzDahQkH_PsjaUY=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCy9mgxB8pn2C4aNK_MPthDQ",
    handle: "@SuzunaTsuzuri",
    name: "鈴鳴つづり",
    group: "アソビ★まわり隊！",
    icon: "https://yt3.googleusercontent.com/XcXvmoDV0Cx77O7Lh730dwbR-f2-XlSwPSdvcfh_zS5jBY3R2Qe0NWEGeJTWVXDY025ShlmER2o=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCSjQDxud2HkAO2DVD3lwxmw",
    handle: "@HyakutoKyoko",
    name: "百灯キョーコ",
    group: "アソビ★まわり隊！",
    icon: "https://yt3.googleusercontent.com/ICKlWnk7O6HXu8Y46SJhzgTUvCAwGWaEaGrrrT88VpGOerP9BOpZtYOKZ7MB5fIgAa4_R4u1ncM=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCOyYb1c43VlX9rc_lT6NKQw",
    handle: "@ayundarisu",
    name: "アユンダ・リス",
    group: "ID 1期生 AREA15",
    icon: "https://yt3.googleusercontent.com/8dYniYG0Fm49TBxwOW39wDzM25P3aAU7r-wecNaOz5a3I1t8dsYbS5OPZXFeHYQpmVRrY9KrSg=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCP0BspO_AMEe3aQqqpo89Dg",
    handle: "@MoonaHoshinova",
    name: "ムーナ・ホシノヴァ",
    group: "ID 1期生 AREA15",
    icon: "https://yt3.googleusercontent.com/ArbwGFqxm01MKe6qhEnAqIQCro0MUSyI8BVIu-7Ijr3OBw5z86Y1348DTTDFDstWD-uwpIO3=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCAoy6rzhSf4ydcYjJw3WoVg",
    handle: "@AiraniIofifteen",
    name: "アイラニ・イオフィフティーン",
    group: "ID 1期生 AREA15",
    icon: "https://yt3.googleusercontent.com/ghhBoD-8O908tlUkF45A49D5jbEOkzYR7dgxweO-sOdtlOvE21BLtVSpn6w4sapj4YEtAVoc=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCYz_5n-uDuChHtLo7My1HnQ",
    handle: "@KureijiOllie",
    name: "クレイジー・オリー",
    group: "ID 2期生 holoro",
    icon: "https://yt3.googleusercontent.com/fCQ1LUhWHfIGkCLeZl2BG_uQhQ6IqxJ3AJJxFbG6uEpLJ1hlJ2JOoBG7FJiAREeDeEVtwJoZKA=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC727SQYUvx5pDDGQpTICNWg",
    handle: "@AnyaMelfissa",
    name: "アーニャ・メルフィッサ",
    group: "ID 2期生 holoro",
    icon: "https://yt3.googleusercontent.com/I1hkzp7Vty4M-KkSccRORE32t4cFq2HI2uAB1t4BPlwej6_XJ4eRlpy7NNZ9x4JBnqlkOnGz=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UChgTyjG-pdNvxxhdsXfHQ5Q",
    handle: "@PavoliaReine",
    name: "パヴォリア・レイネ",
    group: "ID 2期生 holoro",
    icon: "https://yt3.googleusercontent.com/gV1Zr_UQCBsmfyqaJhgj46qud_7HkvdqDNobqz-GSY7cQ4GNSltNxAyc1Y1-9HXXvSoORbzc=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCTvHWSfBZgtxE4sILOaurIQ",
    handle: "@VestiaZeta",
    name: "ベスティア・ゼータ",
    group: "ID 3期生 holoh3ro",
    icon: "https://yt3.googleusercontent.com/0pxwGbJZbeMVkF9wGW4FNE2vJERPo0zUkzSEFWj6IHio-uiLWMSJKdjhkqwRkWwDHNu0dXiynw=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCZLZ8Jjx_RN2CXloOmgTHVg",
    handle: "@KaelaKovalskia",
    name: "カエラ・コヴァルスキア",
    group: "ID 3期生 holoh3ro",
    icon: "https://yt3.googleusercontent.com/2jGAglj5aTcUWO7WRNfq54KV3ipKblUzxI6fAKSjAfMw6J9Qqb6NbzbJA2i0t4cKgUR7SPdWC_w=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCjLEmnpCNeisMxy134KPwWw",
    handle: "@KoboKanaeru",
    name: "こぼ・かなえる",
    group: "ID 3期生 holoh3ro",
    icon: "https://yt3.googleusercontent.com/XRCP2PC-lvvielp04Eq8KyBzgd3_bFc_DNfptN5s-ftd1v6SadGuMChY6Jm3elaqaK7xwE1B=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCL_qhgtOy0dy1Agp8vkySQg",
    handle: "@MoriCalliope",
    name: "森カリオペ",
    group: "EN Myth",
    icon: "https://yt3.googleusercontent.com/LYO40yqUG6y_YiIND-FCD_MSPOeREAoLSVdVLL0UDmFSuwbbblBDNpRx5CAKlO75NrtLo6CnsnQ=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCHsx4Hqa-1ORjQTh9TYDhww",
    handle: "@TakanashiKiara",
    name: "小鳥遊キアラ",
    group: "EN Myth",
    icon: "https://yt3.googleusercontent.com/vnzn_RiKneABPPnp1-0SO4IAZQRXqVsL5RNDQYGR9GhT-Flm47vM4UJeyGfn4U_gteKqJMBwNA=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCMwGHR0BTZuLsmjY_NT5Pwg",
    handle: "@NinomaeInanis",
    name: "一伊那尓栖",
    group: "EN Myth",
    icon: "https://yt3.googleusercontent.com/hJ45UDEa_rKtqxjNcIcYYJ_3eBvl9Jj2H-gXHBwNDwKOcSvDLjSwgOVbU9tEbUQmpGnyGwQFLQ=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC8rcEBzJSleTkf_-agPM20g",
    handle: "@IRyS",
    name: "IRyS",
    group: "EN Project: HOPE",
    icon: "https://yt3.googleusercontent.com/zztv3u0fMtIbGu5nLjKPTwR_8-U0nSq80kmWW0xBpc42tA6dFHlDb_TG3VjSPLNFBuAIZtaFrw=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCmbs8T6MWqUHP1tIQvSgKrg",
    handle: "@OuroKronii",
    name: "オーロ・クロニー",
    group: "EN Council / Promise",
    icon: "https://yt3.googleusercontent.com/XxF6c2VtpdbRdLcldz5jp05FQY_JTfOXeVd8osfAZsxODIanpt0ymcn_6nitwydHNGek46cfZ04=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCgmPnx-EEeOrZSg5Tiw7ZRQ",
    handle: "@HakosBaelz",
    name: "ハコス・ベールズ",
    group: "EN Council / Promise",
    icon: "https://yt3.googleusercontent.com/sFBVGkudEnu_MCH23nJdS2oTnOzd9M7e6Mgki5JBhbj4PnjWGgG2hNmW2Vozw5rr8-K0s-DpaPs=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCgnfPPb9JI3e9A4cXHnWbyg",
    handle: "@ShioriNovella",
    name: "シオリ・ノヴェラ",
    group: "EN Advent",
    icon: "https://yt3.googleusercontent.com/q23ZTL-eIurUV4sMNtq5pJpFXWKI7dr-XuScFGVtSiDhTR_jrs4v1BpsWX1WP51sP4jjlmA=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC9p_lqQ0FEDz327Vgf5JwqA",
    handle: "@KosekiBijou",
    name: "古石ビジュー",
    group: "EN Advent",
    icon: "https://yt3.googleusercontent.com/Wk5Mbh-5z_dbHTp7Hyz7OSd70Cz4GknlZOqiI2J_sIsnbm_YjWN2vb39XyrXBYj-uiMsOi-95w=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC_sFNM0z0MWm9A6WlKPuMMg",
    handle: "@NerissaRavencroft",
    name: "ネリッサ・レイヴンクロフト",
    group: "EN Advent",
    icon: "https://yt3.googleusercontent.com/V1Ow-KEzUUTOpE6dp3oQzxRAH1t-zwkfnlG8lGG6TbJ5SLPyfNXCSH3xAGVmaDEZfNA4xe4kJQ=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCt9H_RpQzhxzlyBxFqrdHqA",
    handle: "@FUWAMOCOch",
    name: "FUWAMOCO",
    group: "EN Advent",
    icon: "https://yt3.googleusercontent.com/eC6k63zvyZma-t4NwtxhKXaP7smdQuXM6KA9r8i-ZLxnfSh5ngfAPibEAwtbFy4QEGnt_lY6lA=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCW5uhrG1eCBYditmhL0Ykjw",
    handle: "@holoen_erbloodflame",
    name: "エリザベス・ローズ・ブラッドフレイム",
    group: "EN Justice",
    icon: "https://yt3.googleusercontent.com/1aoKeoCGzuD7XK2U8nUIHfpynIOLecHxF7Adh09XshlrL9kne2uKGOllFcoA2iXBVVe51_V6E48=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCDHABijvPBnJm7F-KlNME3w",
    handle: "@holoen_gigimurin",
    name: "ジジ・ムリン",
    group: "EN Justice",
    icon: "https://yt3.googleusercontent.com/VTrjE6XoUY0QRq9VgwPIADiUA1S2FYPvJ7qRpUpgix8JLiU-mjKwEtADjS35w9C21Yarxk9kKA=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCvN5h1ShZtc7nly3pezRayg",
    handle: "@holoen_ceciliaimmergreen",
    name: "セシリア・イマーグリーン",
    group: "EN Justice",
    icon: "https://yt3.googleusercontent.com/sSuJylnDA4Si69bKWVzwUhrOhgIkBCzGE6DHgDyHCJux8TKi7WU8GyKaKZHEN0a3QG7s2yJ399g=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCl69AEx4MdqMZH7Jtsm7Tig",
    handle: "@holoen_raorapanthera",
    name: "ラオーラ・パンテーラ",
    group: "EN Justice",
    icon: "https://yt3.googleusercontent.com/HKYI1ENbRIVyDgLVtpxOKyLAOEdOHWH__-JQu6Kj2dq0S9U-wTccKoZT0-4DBd21O0Cpo6NnlA=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCozx5csNhCx1wsVq3SZVkBQ",
    handle: "@holoANroom",
    name: "holoAN room",
    group: "holoAN",
    icon: "https://yt3.googleusercontent.com/bLqkQmKBq5rRp53-TLpg1wa9Bn0aFwmjsnZ6LTPgq0NjJSs2304Rm61481alRP8mTdyNLFiJ9c0=s88-c-k-c0x00ffffff-no-rj"
  },
  // ---- 公式系 (公式サイト /about のチャンネル一覧 + ホロジュールの COVER 欄。2026-11-20 確認)
  {
    channelId: "UCJFZiqLMntJufDCHc6bQixg",
    handle: "@hololive",
    name: "ホロライブ公式",
    group: "公式",
    icon: "https://yt3.googleusercontent.com/rl6ZG9_MqKPDABLRDNG75FPX7EOPGXHtJ-2Hm97yqWziq6gkcwnsSe6wA8vv8xIhGuQe9joF=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCotXwY6s8pWmuWd_snKYjhg",
    handle: "@hololiveEnglish",
    name: "hololive English",
    group: "公式",
    icon: "https://yt3.googleusercontent.com/TvszWVCadS-5F30r3omWB2K2SZWfu6ZTcKHZ69N7Mmb0Qx6VD22vgaKkEkm9frbF_x2pnx7K=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCfrWoRGlawPQDQxxeIDRP0Q",
    handle: "@hololiveIndonesia",
    name: "hololive Indonesia",
    group: "公式",
    icon: "https://yt3.googleusercontent.com/Z20y_dnNBDh2qiAY3m_8VYJ4HcokDFTnX0hjM9oJsTrmhTVapZA1EtGpE7nLKvzwo6FfehAn1w=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UC10wVt6hoQiwySRhz7RdOUA",
    handle: "@hololiveDEV_IS",
    name: "ReGLOSS 公式",
    group: "公式",
    icon: "https://yt3.googleusercontent.com/VSEPzRMRZy7FNnZmFujYmVgG24tdNxaLYxfbnQT998wkxBBKm-1VAOq-rbsNZJ-hghM4Ov3FyQ=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCu2n3qHuOuQIygREMnWeQWg",
    handle: "@DEV_IS_FLOWGLOW",
    name: "FLOW GLOW 公式",
    group: "公式",
    icon: "https://yt3.googleusercontent.com/f9oGulIUN9RbJyNpc-WT3d5aJGJ_9p1Mug3WV6ZkBBQtImvYSusfmMbW03KMY8jZf1kJsHu3jOs=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCAHwWUotyS3l2qBetFDsjgQ",
    handle: "@hololive_ASOBIMAWARITAI",
    name: "アソビ★まわり隊！ 公式",
    group: "公式",
    icon: "https://yt3.googleusercontent.com/dq_Yzt9WRv6MhuF04AKL6TR-Rm6cXE36D8WCtFcWx2J6ZQ5tTf_9Cno6Nb4-KiNsGJlBeG-_hg=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCmms2EE02mK4zdECwrHBpaA",
    handle: "@hololiveOCGch",
    name: "ホロカ公式 (OFFICIAL CARD GAME)",
    group: "公式",
    icon: "https://yt3.googleusercontent.com/auWUDx657AsLAGf8xx-NDUgiWGd9DOxM9qTYI_nMCZktK7OOdz_CT0xYSLKONO2H8IzlUkaEig=s88-c-k-c0x00ffffff-no-rj"
  },
  {
    channelId: "UCawGfU44CZxd2ZVf_VGijbA",
    handle: "@hololivedreams",
    name: "ホロドリ (hololive Dreams)",
    group: "公式",
    icon: "https://yt3.googleusercontent.com/xYBZ3SRfI0dFYmNmUCSvZJ19Jsr6ax6TZQA6Q4ynehOOmNS5TwlFaYXLHeaEEs7w11PtC6VmFu8=s88-c-k-c0x00ffffff-no-rj"
  }
];
