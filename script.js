// 简单的交互功能
document.addEventListener('DOMContentLoaded', function() {
    // 添加平滑滚动
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });

    // 添加文章卡片的悬停效果
    const articles = document.querySelectorAll('.article');
    articles.forEach(article => {
        article.addEventListener('mouseenter', function() {
            this.style.transform = 'translateX(4px)';
            this.style.transition = 'transform 0.2s ease';
        });
        
        article.addEventListener('mouseleave', function() {
            this.style.transform = 'translateX(0)';
        });
    });

    // 打印欢迎信息
    console.log('%c李子木的个人博客', 'font-size: 24px; font-weight: bold; color: #1a1a1a;');
    console.log('%c欢迎访问！', 'font-size: 14px; color: #666;');
});