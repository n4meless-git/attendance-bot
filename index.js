require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// 1. 설정
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);
});

// 2. 출근 로직
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.content !== "출근") return;

    const userId = message.author.id;
    const username = message.author.username;
    
    // 한국 시간(KST) 계산
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset);
    
    const today = kstDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentHour = kstDate.getUTCHours(); // 한국 시간 기준 시(0~23)

    // [어뷰징 방지] 0시 ~ 4시 사이 출근 차단
    if (currentHour >= 0 && currentHour < 4) {
        return message.reply("🚫 **지금은 출근 금지 시간입니다!**\n상쾌한 아침 공기를 마시며 다시 와주세요! 😴");
    }

    try {
        const { data: user, error: selectError } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (selectError) throw selectError;

        // 1. 이미 오늘 출근했는지 확인
        if (user && user.last_checkin === today) {
            return message.reply(`이미 오늘 출근하셨어요! ✨\n(오늘 날짜: ${today})`);
        }

        // 2. 연속 출근(Streak) 계산
        let newStreak = 1;
        if (user && user.last_checkin) {
            const yesterday = new Date(kstDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (user.last_checkin === yesterdayStr) {
                newStreak = (user.streak || 0) + 1;
            }
        }

        // 3. 데이터 업데이트
        const { error: upsertError } = await supabase
            .from('attendance')
            .upsert({
                user_id: userId,
                username: username,
                last_checkin: today,
                streak: newStreak
            }, { onConflict: 'user_id' });

        if (upsertError) throw upsertError;

        message.reply(`✅ **출근 완료!** 현재 **${newStreak}일** 연속 출근 중! 🔥\n오늘 하루도 힘차게 시작해봐요!`);

    } catch (err) {
        console.error("에러 발생:", err);
        message.reply("⚠️ DB 처리 중 오류가 발생했습니다!");
    }
});

client.login(process.env.DISCORD_TOKEN);
