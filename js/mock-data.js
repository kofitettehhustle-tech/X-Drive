// X Drive Mock Services Data
const featuredServices = [
    {
        id: "instagram-followers",
        platform: "Instagram",
        category: "Followers",
        title: "Instagram Followers",
        description: "Build your audience with a service designed for steady growth.",
        pricePer1000: 4.50,
        minimum: 100,
        maximum: 100000
    },
    {
        id: "instagram-likes",
        platform: "Instagram",
        category: "Likes",
        title: "Instagram Likes",
        description: "Boost your engagement and reach the explore page.",
        pricePer1000: 1.20,
        minimum: 50,
        maximum: 50000
    },
    {
        id: "tiktok-views",
        platform: "TikTok",
        category: "Views",
        title: "TikTok Views",
        description: "Increase visibility and hit the For You page.",
        pricePer1000: 0.15,
        minimum: 1000,
        maximum: 1000000
    },
    {
        id: "tiktok-followers",
        platform: "TikTok",
        category: "Followers",
        title: "TikTok Followers",
        description: "Grow your fanbase with high-quality profiles.",
        pricePer1000: 5.00,
        minimum: 100,
        maximum: 50000
    },
    {
        id: "youtube-views",
        platform: "YouTube",
        category: "Views",
        title: "YouTube Views",
        description: "Build your channel's loyal audience and watch time.",
        pricePer1000: 2.50,
        minimum: 1000,
        maximum: 500000
    }
];

const xDriveServices = featuredServices.map((service) => ({
    ...service,
    name: service.title,
    enabled: true,
    supplierCost: Number((service.pricePer1000 * 0.45).toFixed(2)),
    xDriveBasePrice: Number((service.pricePer1000 * 0.9).toFixed(2)),
    currentResellerPrice: Number((service.pricePer1000 * 1.2).toFixed(2)),
    defaultResellerMarkup: 0.2
}));

const xDrivePlatforms = [...new Set(xDriveServices.map((service) => service.platform))];

const xDrivePlatformStats = {
    totalRevenue: 125000,
    xDriveProfit: 38000,
    resellerRevenue: 62000,
    activeResellers: 125
};

window.mockData = {
    featuredServices
};

window.XDriveMockData = {
    services: xDriveServices,
    platforms: xDrivePlatforms,
    platformStats: xDrivePlatformStats
};
