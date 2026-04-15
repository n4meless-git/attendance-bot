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
    
    // [확인용] 한국 시간(KST, UTC+9) 계산
    const now = new Date();
    const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const today = kstDate.toISOString().split('T')[0];

    try {
        const { data: user } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .single();

        // [테스트 포인트] 이미 출근했어도 날짜를 보여주게 수정함
        if (user && user.last_attendance_date === today) {
            return message.reply(`봇이 인식한 한국 날짜: **${today}**\n이미 오늘 출근하셨어요! ✨ (밤 12시에 리셋됩니다)`);
        }

        let newStreak = 1;
        if (user) {
            const yesterday = new Date(kstDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (user.last_attendance_date === yesterdayStr) {
                newStreak = (user.streak || 0) + 1;
            }
        }

        const { error } = await supabase
            .from('attendance')
            .upsert({
                user_id: userId,
                username: username,
                last_attendance_date: today,
                streak: newStreak
            }, { onConflict: 'user_id' });

        if (error) throw error;

        // [테스트 포인트] 출근 성공 시에도 날짜 표시
        message.reply(`봇이 인식한 한국 날짜: **${today}**\n✅ **출근 완료!** 현재 **${newStreak}일** 연속 출근 중! 🔥`);

    } catch (err) {
        console.error(err);
        message.reply("⚠️ 오류 발생! 로그를 확인하세요.");
    }
});

client.login(process.env.DISCORD_TOKEN);
